set -x
mkdir -p ../build
clang++-22 -std=c++26 -g \
    -DLIBUS_USE_OPENSSL \
    -I ../ext/native/include/uWebSockets \
    -I ../ext/native/include/uSockets \
    -I ../ext/native/include \
    main.cpp \
    ../ext/native/lib/uSockets.a \
    -lssl \
    -lcrypto \
    -lz -lpthread \
    -o ../build/server
../build/server

# -I ../deps/uWebSockets/uSockets/boringssl/include \
# ../ext/native/lib/libssl.a \
# ../ext/native/lib/libcrypto.a \
