set -x
cd spiel
./build_wasm.sh
cd ../ext
./generate_certificates.sh
cd ../server
./build_local.sh
