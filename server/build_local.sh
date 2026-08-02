set -x
g++ -std=c++20 -march=native -g \
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
../build/server
