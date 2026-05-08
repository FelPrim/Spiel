#include "spiellib.h"
#include <stdio.h>

void change_state(void){
	static int state = 0;
	printf("%d\n", state++);
	fflush(stdout);
}
