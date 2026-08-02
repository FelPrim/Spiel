clang-22 -std=c23 \
	--target=wasm32 \
	-nostdlib \
	-fno-builtin-strlen \
	-Wl,--no-entry \
	-Oz \
	spiel.c -o ../client/spiel.wasm
wasm-strip ../client/spiel.wasm
