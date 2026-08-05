set -x
g++ -std=c++20 -march=native -g \
    -DLIBUS_USE_OPENSSL \
    -I ../ext/native/include/uWebSockets \
    -I ../ext/native/include/uSockets \
    -I ../ext/native/include \
    -I ../deps/uWebSockets/uSockets/boringssl/include \
    main.cpp \
    ../ext/native/lib/uSockets.a \
    ../ext/native/lib/libssl.a \
    ../ext/native/lib/libcrypto.a \
    -lz -lpthread \
    -o ../build/server
../build/server
