#!/bin/bash
set -x
cd deps/wslay
autoreconf -i
automake
autoconf
./configure --prefix="$PWD/../../include" \
	CFLAGS="-O3 -march=native -fno-strict-aliasing"
make -j$(nproc)
make install
export PKG_CONFIG_PATH="$PWD/../../include/lib/pkgconfig:$PKG_CONFI_PATH"
cd ../h2o
mkdir build
cd build
cmake -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_INSTALL_PREFIX="$PWD/../../../include" ..
make libh2o-evloop -j$(nproc)
make install
