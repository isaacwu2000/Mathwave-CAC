"""Test queue evidence archives without network, SDK deployment or GPU calls."""
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from runpod_queue import safe_extract, pack_results


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


if __name__ == '__main__':
    unittest.main()
