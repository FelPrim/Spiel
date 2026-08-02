clang-22 -std=c23 \
	--target=wasm32 \
	-nostdlib \
	-Wl,--no-entry \
	-Wl,--initial-memory=20971520 \
	-Wl,--export=alloc \
	-Wl,--export=process \
	-Wl,--export=get_errno \
	-Wl,--export-memory \
	-Oz \
	spiel.c -o ../build/spiel.wasm
wasm-strip ../build/spiel.wasm
