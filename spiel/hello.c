#include <stdint.h>

void process(uint32_t ptr, uint32_t size){
	int32_t *buffer = (int32_t *)(uintptr_t)ptr;
	for (uint32_t i = 0; i < size; ++i)
		buffer[i] ^= 0xFF;
}
