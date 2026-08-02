#include "useful.h"
int32_t err_no = 0;

#define MEMSIZE 16777216

volatile alignas(1024) uint8_t Memory[MEMSIZE];
volatile uint32_t counter = 0;

u32 get_memory_base(void)
{
    return (u32)(uintptr_t)Memory;
}

u32 alloc(i32 alignment, i32 size, i32 count){
	//CHECK(alignment < 1024, 52);
	int32_t waste = 0;
	if (counter % alignment != 0)
		waste = alignment - counter % alignment;
	if (counter + waste + size * count > MEMSIZE){
		err_no = ERROR_OUT_OF_MEMORY;
		return (uint32_t)(-1); // I trust it isn't UB
	}
	u32 return_value = counter + waste;
	counter += waste + size * count;
	return return_value;
}

i32 get_errno(){
	return err_no;
}

void process(uint32_t ptr, u32 size){
	volatile uint32_t * const arr = (volatile uint32_t *)(Memory + ptr);
	for (uint32_t i = 0; i < size; ++i)
		arr[i] = i;
}
