/* code was copied from: https://github.com/uNetworking/uWebSockets/blob/master/examples/EchoServer.cpp */


/* We simply call the root header file "App.h", giving you uWS::App and uWS::SSLApp */
#define WITH_OPENSSL 1
#include "App.h"
#include <cstdio>

/* This is a simple WebSocket echo server example.
 * You may compile it with "WITH_OPENSSL=1 make" or with "make" */


int main() {

	constexpr bool USING_SSL = true;
	constexpr bool IS_SERVER = true;
	constexpr bool IS_LOCALHOST = true;
	constexpr int PORT = 9001;
	
    /* ws->getUserData returns one of these */
    struct PerSocketData {
        /* Fill with user data */
    };
	using WS = uWS::WebSocket<USING_SSL, IS_SERVER, PerSocketData>;

    /* Keep in mind that uWS::SSLApp({options}) is the same as uWS::App() when compiled without SSL support.
     * You may swap to using uWS:App() if you don't need SSL */
	static_assert(USING_SSL && WITH_OPENSSL==1, "change SSLApp to App");
    uWS::SSLApp app({
        /* There are example certificates in uWebSockets.js repo */
        .key_file_name = (IS_LOCALHOST)?
			"../misc/localhost-key.pem":
			"../misc/key.pem",
        .cert_file_name = (IS_LOCALHOST)?
			"../misc/localhost.pem":
			"../misc/cert.pem",
        .passphrase = (IS_LOCALHOST)?
			"":
			"1234"
    });
	app.ws<PerSocketData>("/*", {
        /* Settings */
        .compression = uWS::CompressOptions(uWS::SHARED_COMPRESSOR | uWS::SHARED_DECOMPRESSOR),
        .sendPingsAutomatically = true,
		
        /* Handlers */
		// before HTTP connection turns into WebSocket
        // .upgrade = nullptr,
		// websocket created successfully
        .open = [](WS* ws) {
            /* Open event here, you may access ws->getUserData() which points to a PerSocketData struct */

			// TODO
			puts(".open called");
        },
		// recvd a message
        .message = [](WS* ws, std::string_view message, uWS::OpCode opCode) {
            /* This is the opposite of what you probably want; compress if message is LARGER than 16 kb
             * the reason we do the opposite here; compress if SMALLER than 16 kb is to allow for 
             * benchmarking of large message sending without compression */
            /* Never mind, it changed back to never compressing for now */
            //ws->send(message, opCode, false);
			
			// TODO
			std::puts(".message called");
        },
		// if client reads msgs slowly and server sends them fast there will be a buffer of messages
		// if this buffer is overflown, messages will need to be dropped!
        // .dropped = [](auto */*ws*/, std::string_view /*message*/, uWS::OpCode /*opCode*/) {
        //     /* A message was dropped due to set maxBackpressure and closeOnBackpressureLimit limit */
        // },
		// if buffer was overflown but now client caught up
        // .drain = [](auto */*ws*/) {
        //     /* Check ws->getBufferedAmount() here */
        // },
		// ping
        // .ping = [](auto */*ws*/, std::string_view) {
        //     /* Not implemented yet */
        // },
		// // pong
        // .pong = [](auto */*ws*/, std::string_view) {
        //     /* Not implemented yet */
        // },
		// client disconnected
        .close = [](WS* ws, int code, std::string_view message) {
            /* You may access ws->getUserData() here */
			
			// TODO
			puts(".close called");
        }
    })
	.get("/*", [](auto* res, auto* req) {
        std::string_view url = req->getUrl();
        
        if (url == "/" || url == "/index.html") {
			// should be fixed later
			FILE* index_html = fopen("../py/index.html", "r");
            char buffer[2048] = {0};
			fseek(index_html, 0, SEEK_END);
			int file_sz = ftell(index_html);
			fseek(index_html, 0, SEEK_SET);
			
			int bytes_read = fread(buffer, 1, file_sz, index_html);
			buffer[bytes_read] = '\0';
            
            res->writeHeader("Content-Type", "text/html; charset=utf-8");
            res->end(buffer);
			fclose(index_html);
        }
        else if (url == "/health") {
            res->writeHeader("Content-Type", "application/json");
            res->end(R"({"status":"ok","port":9001})");
        }
        else {
            res->writeStatus("404 Not Found");
            res->end("Not found");
        }
    })
	.options("/*", [](auto* res, auto* req) {
        res->writeHeader("Access-Control-Allow-Origin", "*");
        res->writeHeader("Access-Control-Allow-Headers", "*");
        res->writeStatus("204 No Content");
        res->end();
    })
	.listen(PORT, [](us_listen_socket_t* const listen_socket) {
        if (listen_socket) {
            printf("Listening on https://localhost:%d and wss://localhost:%d\n", PORT, PORT);
        } else {
            puts("Failed to listen");
        }
    }).run();
}