#pragma once

#include <stdint.h>

typedef const uint8_t   u8;
typedef const int32_t  i32;
typedef const uint32_t u32;
typedef const uint64_t u64;

#define likely(x)   __builtin_expect(!!(x), 1)
#define unlikely(x) __builtin_expect(!!(x), 0)

extern int32_t err_no;
#define ERROR_OUT_OF_MEMORY 137

// TODO: add printing to js

//void CHECK(bool value, int32_t err_code){
//    if (likely(value && !err_code))
//        return;
//    err_no = err_code;
//}