/* code was partially copied from: https://github.com/uNetworking/uWebSockets/blob/master/examples/EchoServer.cpp */


/* We simply call the root header file "App.h", giving you uWS::App and uWS::SSLApp */
#define WITH_OPENSSL 1
#include "App.h"
#include <cstdio>
#include <cstdlib>
#include <cstdarg>
#include <cassert>
#include <cstring>

#include <initializer_list>
#include <utility>
#include <type_traits>

constexpr bool DEBUGGING = true;
//constexpr bool USING_SSL = true;
constexpr bool IS_SERVER = true;
#define IS_LOCALHOST true
// I think that I will use setcap
#if IS_LOCALHOST
	const char SERVERNAME[] = "localhost";
	constexpr int HTTPPORT  = 23233;
	constexpr int HTTPSPORT = 23234;
	// std::format is taking too long
	#define HTTPPORT_STR  "23233"
	#define HTTPSPORT_STR "23234"
#else
	const char SERVERNAME[] = "???spiel.com, ig???";
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
		puts(cstr);
		puts("A");
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

void load_and_process_file(const char *dir, const char *name, Pstr str) {
	assert(strlen(dir) + strlen(name) + 2 <= 256);
	char cstr[256] = "";
	strcpy(cstr, dir);
	strcat(cstr, "/");
	strcat(cstr, name);
    FILE* file = fopen(cstr, "r");
    if (!file) { 
		// file should exist
		puts(cstr);
		perror("fopen"); 
		abort(); 
	}
    fseek(file, 0, SEEK_END);
    int file_sz = ftell(file);
    if (file_sz == -1) { 
		// should be able to read file
		perror("file_sz == -1"); 
		fclose(file); 
		abort();
	}
    fseek(file, 0, SEEK_SET);
    int bytes_read = fread(str.buffer, 1, file_sz, file);
	if(bytes_read != file_sz){
		// error when reading file
		perror("bytes_read != file_sz"); 
		fclose(file);
		abort();
	}
	str.buffer[bytes_read] = '\0';
	
	const char marker_start[] = "<!-- #include("; // Yeah, if u add extra space this wouldn't work. So, don't add extra space!
	const char marker_end[] = ") -->";
	const int len_start = strlen(marker_start);
	const int len_end  = strlen(marker_end);

	char *str_start = strstr(str.buffer, marker_start);
	char *str_end   = strstr(str_start, marker_end);

	// TODO
	while(str_start && str_end){
		char* part_after = strdup(str_end + len_end);

		str_end[0] = '\0';
		const char* PATH = str_start + len_start;
		puts(PATH); // TODO убрать
		assert(strlen(dir) + strlen(PATH) + 2 <= 256);
		char dstr[256] = "";
		strcpy(dstr, dir);
		strcat(dstr, "/");
		strcat(dstr, PATH);
		FILE* f = fopen(dstr, "r");
		if (!f){
			// TODO normal errormessage
			puts(dstr);
			perror("fopen"); 
			abort();
		}
		fseek(f, 0, SEEK_END);
		int size = ftell(f);
		bytes_read += size;
		fseek(f, 0, SEEK_SET);


		str_start[0] = '\0';
		const int index = strlen(str.buffer);
		memset(str_start, 0, file_sz - index); 
		
		
		fread(str.buffer + index, 1, size, f);
		str.buffer[index + size] = '\0'; // should be unnecessary
		strcat(str.buffer, part_after);

		fclose(f);
		char* after_start = strstr(part_after, marker_start);
		char* after_end   = strstr(part_after, marker_end);
		if (!after_start || !after_end){
			free(part_after);
			break;
		}
		str_start += after_start - part_after;
		str_end   += after_end   - part_after;
		free(part_after);
	}
	
	if (str.size < bytes_read) {
		// should be able to store file in buffer
		printf("buffersize: %d\nbytes_read: %ld\n", str.size, bytes_read);
		puts("Make buffersize larger!");
		fclose(file);
		abort();
	}
	str.size = bytes_read;
	
    fclose(file);
}


/* ws->getUserData returns one of these */
struct PerSocketData {
	/* Fill with user data */
	static constexpr size_t MAX_COOKIE = 255;
	char cookie[MAX_COOKIE];
    unsigned char cookie_len = 0;  

	PerSocketData(std::string_view the_cookie){
		assert(the_cookie.size() < MAX_COOKIE);
		memcpy(cookie, the_cookie.data(), the_cookie.size());
		cookie_len = the_cookie.size();
	}
	PerSocketData(){
		assert(0);
//		std::unreachable();
	}
//	PerSocketData(std::initializer_list<> a){
//		assert(a.empty());
//	}
};

//using WS = uWS::WebSocket<USING_SSL, IS_SERVER, PerSocketData>;
template <typename AppType>
void setup_routes(
	AppType& app, Pstr index_html
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
        .upgrade = [](auto *res, auto *req, auto *context) {
			std::string_view raw = req->getHeader("cookie");
			if (raw.size() >= PerSocketData::MAX_COOKIE) {
				res->writeStatus("400 Bad Request")->end();
				return;
			}

			res->template upgrade<PerSocketData>(
                /* We initialize PerSocketData struct here */
				std::move(PerSocketData(raw)),
				req->getHeader("sec-websocket-key"),
                req->getHeader("sec-websocket-protocol"),
                req->getHeader("sec-websocket-extensions"),
                context);
		},
		// websocket created successfully
        .open = [](auto* ws) {
			puts(".open called");
			auto* data = ws->getUserData();
			puts("@");
			printf("%.*s", (int)data->cookie_len, data->cookie);
			puts("@");
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
			ws->send("Hello, Client!", uWS::TEXT, false);
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
	.get("/*", [index_html](auto* res, auto* req) {
        std::string_view url = req->getUrl();
		if (DEBUGGING)
			printf("[DEBUG] Request URL: '%.*s'\n", (int)url.size(), url.data());
        
        if (url == "/") {
            res->writeHeader("Content-Type", "text/html; charset=utf-8");
			res->end(index_html.buffer);
        }
/*		else if (url == "/main.js"){
			res->writeHeader("Content-Type", "application/javascript; charset=utf-8");
			res->end(main_js.buffer);
		}*/
        else if (url == "/health") {
            res->writeHeader("Content-Type", "application/json");
			if constexpr (std::is_same_v<AppType, uWS::SSLApp>)
				res->end(R"({"status":"ok", "port":)" HTTPSPORT_STR "}");
			else 
				res->end(R"({"status":"ok", "port":)" HTTPPORT_STR "}");
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
	load_and_process_file("../../client", "index.html", index_html);

/*	constexpr int main_js_sz = 1024;
	char main_js_first_arg[main_js_sz];
	Pstr main_js = {
		main_js_first_arg,
		main_js_sz
	};
	load_file("../../client/main.js", main_js);
	*/
    /* Keep in mind that uWS::SSLApp({options}) is the same as uWS::App() when compiled without SSL support.
     * You may swap to using uWS:App() if you don't need SSL */
//	static_assert(USING_SSL && WITH_OPENSSL==1, "change SSLApp to App");

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

	setup_routes<uWS::SSLApp>(https_app, index_html);
	https_app.listen(HTTPSPORT, [](us_listen_socket_t* const listen_socket) {
		if (listen_socket) {
			printf("Listening on https://localhost:%d and wss://localhost:%d\n", HTTPSPORT, HTTPSPORT);
		} else {
			puts("Failed to listen HTTPS");
		}
	});
	uWS::App http_app;
	setup_routes<uWS::App>(http_app, index_html);
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
