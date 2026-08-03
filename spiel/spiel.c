#include "useful.h"
int32_t err_no = 0;

#define MEMSIZE 16777216

volatile alignas(1024) uint8_t Memory[MEMSIZE];
volatile uint32_t counter = 0;

__attribute__((import_module("env"), import_name("js_log"))) extern void js_log(uint32_t ptr, uint32_t len);

void log_string(const char *str) {
    uint32_t len = 0;
    while (str[len]) len++;
	js_log((uint32_t)(uintptr_t)str, len);
}

void CHECK(bool value, const char *err_msg){
	if (likely(value))
		return;
	log_string(err_msg);
}

__attribute__((export_name("get_memory_base")))
u32 get_memory_base(void){
    return (u32)(uintptr_t)Memory;
}

__attribute__((export_name("alloc")))
u32 alloc(i32 alignment, i32 size, i32 count){

	CHECK(alignment > 1024, "testing errors");
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

__attribute__((export_name("get_errno")))
i32 get_errno(){
	return err_no;
}

__attribute__((export_name("process")))
void process(uint32_t ptr, u32 size){
	volatile uint32_t * const arr = (volatile uint32_t *)(Memory + ptr);
	for (uint32_t i = 0; i < size; ++i)
		arr[i] = i;
}
