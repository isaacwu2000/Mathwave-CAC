"""Check loss masking and held-out partition integrity independently of a GPU."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from train_lora import training_tokens, partition_rows, aggregate_losses, GPUBackend, Deadline

class CharacterTokenizer:
    def apply_chat_template(self, messages, tokenize=False, add_generation_prompt=False, **kwargs):
        text=''.join(f"<{m['role']}>{m['content']}!" for m in messages)
        return text + ('<assistant>' if add_generation_prompt else '')
    def __call__(self, text, **kwargs):
        return {'input_ids':[ord(c) for c in text]}

class TrainingDataTests(unittest.TestCase):
    def test_only_final_answer_is_supervised_and_long_inputs_fail(self):
        row={'id':'one','messages':[{'role':'user','content':'secret prompt'},{'role':'assistant','content':'42'}]}
        item=training_tokens(row,CharacterTokenizer(),100)
        self.assertEqual([x for x in item['labels'] if x!=-100],[ord('4'),ord('2'),ord('!')])
        with self.assertRaisesRegex(ValueError,'exceeds'):
            training_tokens(row,CharacterTokenizer(),8)
    def test_conversation_cannot_cross_partitions(self):
        a={'id':'a','caseId':'same','messages':[]};b={**a,'id':'b'}
        with self.assertRaisesRegex(ValueError,'crosses'):
            partition_rows({'train':[a],'val':[b],'test':[]})
    def test_loss_is_weighted_by_supervised_tokens(self):
        self.assertAlmostEqual(aggregate_losses([(2.,1),(4.,3)]),3.5)
        with self.assertRaises(ValueError): aggregate_losses([])

class BackendTests(unittest.TestCase):
    def torch_interface(self, mps=True, cuda=True):
        metal = Mock()
        gpu = Mock()
        metal.is_available.return_value = mps
        gpu.is_available.return_value = cuda
        metal.current_allocated_memory.return_value = 2*1024**3
        metal.driver_allocated_memory.return_value = 3*1024**3
        gpu.memory_allocated.return_value = 4*1024**3
        gpu.memory_reserved.return_value = 5*1024**3
        gpu.get_device_name.return_value = 'Test CUDA GPU'
        gpu.current_device.return_value = 0
        return SimpleNamespace(backends=SimpleNamespace(mps=metal), mps=metal,
                               cuda=gpu, version=SimpleNamespace(cuda='12.8'), __version__='test')

    def test_device_selection_refuses_unavailable_backend_without_fallback(self):
        torch = self.torch_interface(mps=False, cuda=False)
        for device in ('mps', 'cuda'):
            with self.assertRaisesRegex(RuntimeError, 'no silent CPU fallback'):
                GPUBackend(torch, device)
        with self.assertRaises(ValueError): GPUBackend(torch, 'cpu')

    def test_cuda_uses_cuda_for_seed_sync_cache_rng_and_memory(self):
        torch = self.torch_interface()
        backend = GPUBackend(torch, 'cuda')
        backend.seed(42); backend.synchronize(); backend.empty_cache(); backend.rng_state()
        torch.cuda.manual_seed.assert_called_once_with(42)
        torch.cuda.synchronize.assert_called_once_with()
        torch.cuda.empty_cache.assert_called_once_with()
        torch.cuda.get_rng_state.assert_called_once_with()
        torch.mps.synchronize.assert_not_called()
        self.assertEqual(backend.memory(), dict(allocatedGiB=4, reservedGiB=5))
        self.assertEqual(backend.metadata()['gpuName'], 'Test CUDA GPU')
        self.assertEqual(backend.metadata()['cudaVersion'], '12.8')

    def test_mps_keeps_existing_backend_operations(self):
        torch = self.torch_interface()
        backend = GPUBackend(torch, 'mps')
        backend.seed(7); backend.synchronize(); backend.empty_cache(); backend.rng_state()
        torch.mps.manual_seed.assert_called_once_with(7)
        torch.mps.synchronize.assert_called_once_with()
        torch.mps.empty_cache.assert_called_once_with()
        torch.mps.get_rng_state.assert_called_once_with()
        self.assertEqual(backend.memory(), dict(allocatedGiB=2, driverGiB=3))
        self.assertEqual(backend.metadata()['device'], 'mps')

    def test_deadline_checks_elapsed_time_and_rejects_invalid_limits(self):
        times = iter([10, 14, 15])
        deadline = Deadline(5, clock=lambda: next(times))
        deadline.check()
        with self.assertRaises(TimeoutError): deadline.check()
        for value in (0, -1, float('nan'), float('inf')):
            with self.assertRaises(ValueError): Deadline(value)
        Deadline().check()

if __name__=='__main__':unittest.main()
