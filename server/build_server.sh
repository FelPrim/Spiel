set -x
mkdir -p ../build
g++ -std=c++20 -march=haswell -O3 -flto \
    -DLOCAL=0 \
    -DLIBUS_USE_OPENSSL \
    -I ../ext/haswell/include/uWebSockets \
    -I ../ext/haswell/include/uSockets \
    -I ../deps/uWebSockets/uSockets/boringssl/include \
    main.cpp \
    ../ext/haswell/lib/uSockets.a \
    ../ext/haswell/lib/libssl.a \
    ../ext/haswell/lib/libcrypto.a \
    -lz -lpthread \
    -o ../build/server
scp ../build/server felprim@spiel.crabdance.com:~/Spiel
