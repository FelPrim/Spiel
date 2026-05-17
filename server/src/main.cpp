/* code was copied from: https://github.com/uNetworking/uWebSockets/blob/master/examples/EchoServer.cpp */


/* We simply call the root header file "App.h", giving you uWS::App and uWS::SSLApp */
#define WITH_OPENSSL 1
#include "App.h"
#include <cstdio>
#include <cstdlib>
#include <cstdarg>

//#include <initializer_list>
#include <type_traits>

constexpr bool DEBUGGING = true;
constexpr bool USING_SSL = true;
constexpr bool IS_SERVER = true;
#define IS_LOCALHOST true
// I think that I will use setcap
#if IS_LOCALHOST
	constexpr int HTTPPORT  = 23233;
	constexpr int HTTPSPORT = 23234;
	// std::format is taking too long
	#define HTTPPORT_STR  "23233"
	#define HTTPSPORT_STR "23234"
#else
	constexpr int HTTPPORT  = 80;
	constexpr int HTTPSPORT = 443;
	// std::format is taking too long
	#define HTTPPORT_STR  "80"
	#define HTTPSPORT_STR "443"
#endif

/* This is a simple WebSocket echo server example.
 * You may compile it with "WITH_OPENSSL=1 make" or with "make" */

struct Pstr{
	char* buffer;
	int size;
};
// .. - server
// ../.. - Spiel
void load_file(const char *cstr, Pstr str, bool binary=false) {
    FILE* file = fopen(cstr, "rb");
    if (!file) { 
		// file should exist
		perror("fopen"); 
		abort(); 
	}
    fseek(file, 0, SEEK_END);
    long file_sz = ftell(file);
    if (file_sz == -1) { 
		// should be able to read file
		perror("file_sz == -1"); 
		fclose(file); 
		abort();
	}
    fseek(file, 0, SEEK_SET);
    size_t required_size = file_sz + (binary ? 0 : 1);
	if (str.size < required_size) {
		// should be able to store file in buffer
		printf("buffersize: %d\nfilesize: %ld\n", str.size, file_sz);
		puts("Make buffersize larger!");
		fclose(file);
		abort();
	}
    size_t bytes_read = fread(str.buffer, 1, file_sz, file);
	if(bytes_read != file_sz){
		// error when reading file
		perror("bytes_read != file_sz"); 
		fclose(file);
		abort();
	}
	if (not binary)
		str.buffer[bytes_read] = '\0';
	str.size = bytes_read;
    fclose(file);
}

/* ws->getUserData returns one of these */
struct PerSocketData {
	/* Fill with user data */
};

//using WS = uWS::WebSocket<USING_SSL, IS_SERVER, PerSocketData>;
template <typename AppType>
void setup_routes(
	AppType& app, Pstr index_html, Pstr main_js, Pstr favicon
){
/*	if constexpr(std::is_same_v<AppType, uWS::SSLApp>)
		using WS = uWS::WebSocket<true, true, PerSocketData>;
	else
		using WS = uWS::WebSocket<false, true, PerSocketData>;
*/		
	app.template ws<PerSocketData>("/*", {
        /* Settings */
        .compression = uWS::CompressOptions(uWS::SHARED_COMPRESSOR | uWS::SHARED_DECOMPRESSOR),
        .sendPingsAutomatically = true,
		
        /* Handlers */
		// before HTTP connection turns into WebSocket
        // .upgrade = nullptr,
		// websocket created successfully
        .open = [](auto* ws) {
            /* Open event here, you may access ws->getUserData() which points to a PerSocketData struct */

			// TODO
			puts(".open called");
        },
		// recvd a message
        .message = [](auto* ws, std::string_view message, uWS::OpCode opCode) {
            /* This is the opposite of what you probably want; compress if message is LARGER than 16 kb
             * the reason we do the opposite here; compress if SMALLER than 16 kb is to allow for 
             * benchmarking of large message sending without compression */
            /* Never mind, it changed back to never compressing for now */
            //ws->send(message, opCode, false);
			
			// TODO
			puts(".message called");
			if(opCode==uWS::TEXT)
				printf("%.*s", (int)message.size(), message.data());
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
        .close = [](auto* ws, int code, std::string_view message) {
            /* You may access ws->getUserData() here */
			
			// TODO
			puts(".close called");
			printf("%.*s", (int)message.size(), message.data());
        }
    })
	.get("/*", [index_html, main_js, favicon](auto* res, auto* req) {
        std::string_view url = req->getUrl();
		if (DEBUGGING)
			printf("[DEBUG] Request URL: '%.*s'\n", (int)url.size(), url.data());
        
        if (url == "/") {
            res->writeHeader("Content-Type", "text/html; charset=utf-8");
			res->end(index_html.buffer);
        }
		else if (url == "/main.js"){
			res->writeHeader("Content-Type", "application/javascript; charset=utf-8");
			res->end(main_js.buffer);
		}
        else if (url == "/health") {
            res->writeHeader("Content-Type", "application/json");
			if constexpr (std::is_same_v<AppType, uWS::SSLApp>)
				res->end(R"({"status":"ok", "port":)" HTTPSPORT_STR "}");
			else 
				res->end(R"({"status":"ok", "port":)" HTTPPORT_STR "}");
        }
		else if (url == "/ico.png"){
			res->writeHeader("Content-Type", "image/png");
			res->end(
				std::string_view(favicon.buffer,
								favicon.size));
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
    });
}

int main() {
	
	
	constexpr int index_html_sz = 2048;
	char index_html_first_arg[index_html_sz];
	Pstr index_html = {
		index_html_first_arg,
		index_html_sz
	};
	load_file("../../client/index.html", index_html);
	constexpr int main_js_sz = 1024;
	char main_js_first_arg[main_js_sz];
	Pstr main_js = {
		main_js_first_arg,
		main_js_sz
	};
	load_file("../../client/main.js", main_js);
	constexpr int favicon_sz = 8192+4096;
	char favicon_first_arg[favicon_sz];
	Pstr favicon = {
		favicon_first_arg,
		favicon_sz
	};
	load_file("../../client/favicon.png", favicon, true);
    /* Keep in mind that uWS::SSLApp({options}) is the same as uWS::App() when compiled without SSL support.
     * You may swap to using uWS:App() if you don't need SSL */
//	static_assert(USING_SSL && WITH_OPENSSL==1, "change SSLApp to App");
    if constexpr (USING_SSL){
		uWS::SSLApp https_app({
			/* There are example certificates in uWebSockets.js repo */
			.key_file_name = (IS_LOCALHOST)?
				"../misc/localhost-key.pem":
				"../misc/key.pem",
			.cert_file_name = (IS_LOCALHOST)?
				"../misc/localhost.pem":
				"../misc/cert.pem",
			.passphrase = (IS_LOCALHOST)?
				"":
				// TODO
				"1234"
		});

		setup_routes<uWS::SSLApp>(https_app, index_html, main_js, favicon);
		https_app.listen(HTTPSPORT, [](us_listen_socket_t* const listen_socket) {
			if (listen_socket) {
				printf("Listening on https://localhost:%d and wss://localhost:%d\n", HTTPSPORT, HTTPSPORT);
			} else {
				puts("Failed to listen HTTPS");
			}
		});
	}
	uWS::App http_app;
	setup_routes<uWS::App>(http_app, index_html, main_js, favicon);
	http_app.listen(HTTPPORT, [](us_listen_socket_t* const listen_socket){
		if (listen_socket) {
			printf("Listening on http://localhost:%d and ws://localhost:%d\n", HTTPPORT, HTTPPORT);
		} else {
			puts("Failed to listen HTTP");
		}
	});
	// uv_loop is shared, so it doesn't matter what app we are running
	http_app.run();
}
