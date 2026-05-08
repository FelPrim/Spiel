spiel.exe: src/main.cpp ../library_example/libspiel.a
	g++ src/main.cpp -I../library_example/src -o spiel.exe -L../library_example -lspiel
	./spiel.exe

../library_example/libspiel.a: ../library_example/src/spiellib.c ../library_example/src/spiellib.h
	gcc -I../library_example/src -c ../library_example/src/spiellib.c -o ../library_example/spiellib.o
	ar rcs ../library_example/libspiel.a ../library_example/spiellib.o

