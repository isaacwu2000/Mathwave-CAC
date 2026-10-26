"""Test queue evidence archives without network, SDK deployment or GPU calls."""
import base64
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from runpod_queue import safe_extract, pack_results, run_local, validate_cuda_runtime


def archive_with(members):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as archive:
        for name, kind, content in members:
            member = tarfile.TarInfo(name)
            member.type = kind
            if kind == tarfile.REGTYPE:
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
            else:
                member.linkname = '../../outside'
                archive.addfile(member)
    return stream.getvalue()


class QueueArchiveTests(unittest.TestCase):
    def test_valid_payload_extracts_exact_files_and_refuses_existing_destination(self):
        archive = archive_with([('scripts/train_lora.py', tarfile.REGTYPE, b'source'),
                                ('data/train.jsonl', tarfile.REGTYPE, b'{}\n')])
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary)/'payload'
            safe_extract(archive, destination)
            self.assertEqual((destination/'scripts/train_lora.py').read_bytes(), b'source')
            with self.assertRaisesRegex(ValueError, 'must not exist'):
                safe_extract(archive, destination)

    def test_unsafe_paths_links_and_special_members_fail_before_any_write(self):
        cases = [('../outside', tarfile.REGTYPE), ('/outside', tarfile.REGTYPE),
                 ('a/../outside', tarfile.REGTYPE), ('a\\outside', tarfile.REGTYPE),
                 ('C:/outside', tarfile.REGTYPE), ('link', tarfile.SYMTYPE),
                 ('hard', tarfile.LNKTYPE), ('pipe', tarfile.FIFOTYPE)]
        for name, kind in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                destination = Path(temporary)/'payload'
                archive = archive_with([('safe', tarfile.REGTYPE, b'ok'), (name, kind, b'bad')])
                with self.assertRaises(ValueError): safe_extract(archive, destination)
                self.assertFalse(destination.exists())

    def test_duplicate_members_and_size_limits_fail(self):
        archive = archive_with([('same', tarfile.REGTYPE, b'a'), ('same', tarfile.REGTYPE, b'b')])
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary)/'payload'
            with self.assertRaises(ValueError): safe_extract(archive, destination)
            with self.assertRaisesRegex(ValueError, 'Compressed'):
                safe_extract(archive, destination, 1)
            with patch('runpod_queue.MAX_UNPACKED_BYTES', 1):
                with self.assertRaisesRegex(ValueError, 'Unpacked'):
                    safe_extract(archive, destination)

    def test_result_archive_preserves_adapter_and_failure_but_excludes_recovery_and_base(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)/'run'; root.mkdir()
            for name in ('report.json', 'queue-failure.txt', 'adapter/adapter_model.safetensors',
                         'recovery-adapter/adapter_model.safetensors', 'recovery-state.pt',
                         'model.safetensors', 'baseline-test-predictions.jsonl'):
                path = root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'evidence')
            archive = pack_results(root)
            destination = Path(temporary)/'extracted'
            safe_extract(archive, destination)
            self.assertTrue((destination/'adapter/adapter_model.safetensors').exists())
            self.assertTrue((destination/'queue-failure.txt').exists())
            self.assertTrue((destination/'baseline-test-predictions.jsonl').exists())
            self.assertFalse((destination/'model.safetensors').exists())
            self.assertFalse((destination/'recovery-state.pt').exists())
            self.assertFalse((destination/'recovery-adapter').exists())

    def test_normalized_duplicate_members_fail_before_any_write(self):
        for alias in ('a//b', 'a/./b'):
            with self.subTest(alias=alias), tempfile.TemporaryDirectory() as temporary:
                archive = archive_with([('a/b', tarfile.REGTYPE, b'one'),
                                        (alias, tarfile.REGTYPE, b'two')])
                destination = Path(temporary)/'payload'
                with self.assertRaisesRegex(ValueError, 'duplicate'):
                    safe_extract(archive, destination)
                self.assertFalse(destination.exists())

    def test_result_uncompressed_limit_includes_tar_overhead(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)/'run'; root.mkdir()
            (root/'report.json').write_bytes(b'x' * 100)
            with patch('runpod_queue.MAX_UNPACKED_BYTES', 1000):
                with self.assertRaisesRegex(ValueError, 'Unpacked result'):
                    pack_results(root)
            with patch('runpod_queue.MAX_UNPACKED_BYTES', 22000):
                archive = pack_results(root)
                self.assertLessEqual(len(__import__('gzip').decompress(archive)), 22000)
                safe_extract(archive, Path(temporary)/'checked')


class QueueRuntimeTests(unittest.TestCase):
    def test_runtime_assertion_pins_cuda_and_records_mps_difference(self):
        torch = SimpleNamespace(__version__='2.9.1+cu128', version=SimpleNamespace(cuda='12.8'))
        self.assertEqual(validate_cuda_runtime(torch)['mpsReferenceTorchVersion'], '2.14.1')
        torch.__version__ = '2.14.1'
        with self.assertRaisesRegex(RuntimeError, 'Unverified'):
            validate_cuda_runtime(torch)
        torch.__version__ = '2.9.1+cu128'; torch.version.cuda = '12.9'
        with self.assertRaisesRegex(RuntimeError, 'Unverified'):
            validate_cuda_runtime(torch)


class QueueSubmissionTests(unittest.TestCase):
    def setup_paths(self, temporary):
        payload = Path(temporary)/'payload.tar.gz'; payload.write_bytes(b'payload')
        output = Path(temporary)/'result'
        return output, {'MATHWAVE_PAYLOAD_PATH': str(payload),
                        'MATHWAVE_QUEUE_RESULTS': str(output), 'MATHWAVE_QUEUE_PHASE': 'smoke'}

    def test_remote_failure_saves_archive_and_summary_then_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            output, env = self.setup_paths(temporary)
            archive = archive_with([('queue-failure.txt', tarfile.REGTYPE, b'failure trace')])
            job = Mock(id='test-job')
            job.result.return_value = {'error': {'type': 'RuntimeError', 'message': 'failed'},
                                       'archive_b64': base64.b64encode(archive).decode(),
                                       'archive_sha256': hashlib.sha256(archive).hexdigest()}
            queue = Mock(); queue.spawn.return_value = job
            with patch.dict(os.environ, env), redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, 'Remote experiment failed'):
                    run_local(queue)
            self.assertEqual((output/'run/queue-failure.txt').read_bytes(), b'failure trace')
            self.assertTrue((output/'result.tar.gz').exists())
            self.assertIsNotNone(json.loads((output/'queue-result.json').read_text())['error'])
            job.cancel.assert_called_once_with()

    def test_job_record_failure_cancels_and_cleanup_failure_does_not_mask(self):
        with tempfile.TemporaryDirectory() as temporary:
            output, env = self.setup_paths(temporary)
            job = Mock(id='test-job'); job.cancel.side_effect = RuntimeError('cleanup failed')
            queue = Mock(); queue.spawn.return_value = job
            original_write = Path.write_text
            def fail_job_record(path, *args, **kwargs):
                if path.name == 'job.json':
                    raise OSError('original disk failure')
                return original_write(path, *args, **kwargs)
            with patch.dict(os.environ, env), patch.object(Path, 'write_text', fail_job_record):
                with self.assertRaisesRegex(OSError, 'original disk failure'):
                    run_local(queue)
            job.cancel.assert_called_once_with()
            job.result.assert_not_called()
            self.assertEqual(json.loads((output/'cleanup-error.json').read_text())['message'], 'cleanup failed')


if __name__ == '__main__':
    unittest.main()
