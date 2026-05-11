CXX = g++

CXXFLAGS = -std=c++23 -O3 \
    -I../deps/uWebSockets/src \
    -I../deps/uSockets/src \
    -DLIBUS_USE_OPENSSL

LDFLAGS = \
    ../deps/uSockets/uSockets.a \
    -luv \
    -lssl \
    -lcrypto \
    -lz \
    -lws2_32 \
    -lcrypt32 \
    -lbcrypt

SRC = src/main.cpp
OUT = build/server.exe

all:
	mkdir -p build
	$(CXX) $(SRC) $(CXXFLAGS) $(LDFLAGS) -o $(OUT)

clean:
	rm -rf build

