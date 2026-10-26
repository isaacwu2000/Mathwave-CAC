#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

// Reports actual local Metal availability in the executable's target runtime.
// This does not load models, change permissions or establish inference accuracy.
int main(void) {
    @autoreleasepool {
        id<MTLDevice> device = MTLCreateSystemDefaultDevice();
        if (!device) {
            puts("{\"metalAvailable\":false}");
            return 1;
        }
        NSError *error = nil;
        NSString *source = @"#include <metal_stdlib>\nusing namespace metal;\nkernel void probe(device float* value [[buffer(0)]],uint i [[thread_position_in_grid]]) {value[i]+=1.0f;}";
        id<MTLLibrary> library = [device newLibraryWithSource:source options:nil error:&error];
        id<MTLFunction> function = [library newFunctionWithName:@"probe"];
        id<MTLComputePipelineState> pipeline = function ? [device newComputePipelineStateWithFunction:function error:&error] : nil;
        if (!pipeline) {
            NSLog(@"Metal shader probe failed: %@", error);
            return 2;
        }
        float original = 4;
        id<MTLBuffer> buffer = [device newBufferWithBytes:&original length:sizeof(float) options:MTLResourceStorageModeShared];
        id<MTLCommandQueue> queue = [device newCommandQueue];
        id<MTLCommandBuffer> command = [queue commandBuffer];
        id<MTLComputeCommandEncoder> encoder = [command computeCommandEncoder];
        [encoder setComputePipelineState:pipeline];
        [encoder setBuffer:buffer offset:0 atIndex:0];
        [encoder dispatchThreads:MTLSizeMake(1,1,1) threadsPerThreadgroup:MTLSizeMake(1,1,1)];
        [encoder endEncoding];
        [command commit];
        [command waitUntilCompleted];
        float result = *(float *)buffer.contents;
        NSDictionary *report = @{ @"metalAvailable":@YES, @"device":device.name,
                                  @"shaderCompiled":@YES, @"result":@(result),
                                  @"commandStatus":@(command.status) };
        NSData *data = [NSJSONSerialization dataWithJSONObject:report options:0 error:nil];
        printf("%s\n", [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
        return command.status == MTLCommandBufferStatusCompleted && result == 5 ? 0 : 3;
    }
}
