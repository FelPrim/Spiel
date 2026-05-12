CXX = g++

CXXFLAGS = -std=c++23 \
	-I../deps/uWebSockets/src \
	-I../deps/uSockets/src \
	-DLIBUS_USE_OPENSSL \
	-Wall -Wextra

ifeq ($(OS),Windows_NT)
PDLDFLAGS := -lws2_32 -lcrypt32 -lbcrypt
else
PDLDFLAGS := -static-libstdc++
endif

LDFLAGS = \
    ../deps/uSockets/uSockets.a \
    -luv \
    -lssl \
    -lcrypto \
    -lz \
    $(PDLDFLAGS)

SRC = src/main.cpp
OUT = build/server.exe

.PHONY: $(OUT) clean

$(OUT): $(SRC) ../deps/uSockets/uSockets.a | build
	$(CXX) $(SRC) $(CXXFLAGS) $(LDFLAGS) -o $@
	
build:
	mkdir -p build
	
../deps/uSockets/uSockets.a:
	WITH_OPENSSL=1 $(MAKE) -C ../deps/uSockets

clean:
	rm -rf build
