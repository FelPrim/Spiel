#include "ankerl/unordered_dense.h"

// Idea: 
// All information:
// login: char[64] | id: u64 | salt: char[32] | token: char[32] = sha256(login+password+salt)
// password: char[64]	
// All operations:
// login + password -> token
// token -> id
// id -> some info, idk
//
// so, we'll have 3 hash tables (dictionaries in pythonish):
// 1) login: {salt, token}
// 2) token: id
// 3) id: UserInfo
struct AuthDB{
	struct TokenHash {
		size_t operator()(const std::array<uint8_t, 32>& b) const noexcept {
			uint64_t x;
			static_assert(sizeof(size_t) == 8);
			std::memcpy(&x, b.data(), 8);
			return static_cast<const size_t>(x);
		}
	};
	struct LoginValue{
		std::array<uint8_t, 32> salt;
		std::array<uint8_t, 32> token;
	};
	using TokenValue = uint64_t;
	ankerl::unordered_dense::map<const std::array<uint8_t, 32>, TokenValue, TokenHash> token_to_id;
	ankerl::unordered_dense::map<const std::array<uint8_t, 64>, LoginValue> login_to_token;
	uint64_t id_counter;
	// something working with files var
	// RNG context var
	
	// maybe need to add hook to event loop - us_timer_set

	struct AuthInfo{
		std::array<uint8_t, 64> login;
		std::array<uint8_t, 32> salt;
		std::array<uint8_t, 32> token;
		uint64_t user_id;
	};
	// file_add_changes
	std::vector<AuthInfo> add_changes;
	// NOTTODO file_change_changes
	// NOTTODO file_remove_changes
	
	AuthDB(
		// should be able to "capture" uWS event loop - us_timer_set
	){
		// initialize token_to_id and login_to_token with values from predefined binary file.
		// Also they should be able to store at least 1024 elements each
		// This file is literally a vector of AuthInfo. So it should be defined as following:
		// 		First 8 bytes - uint64_t size of this array
		// 		128 bytes - first elem of array:
		//			64 bytes - login
		//			32 bytes - salt
		//			32 bytes - token
		//		128 bytes - second
		//		... 
		// Also it would be really cool if I could hook an event loop used by uWS::App and 
		// start saving maps info into file every N seconds (5 minutes)
		// I don't know how to save this info smartly by rewriting only necessary parts of the file
		// 		Cause I implement only adding new records - I can just write to the end of the existsting file
	}
	~AuthDB(){
		// should close file with storing everything
	}

	std::optional<const std::array<uint8_t, 32>> login_or_register(
		const std::array<uint8_t, 64>& login,
		const std::array<uint8_t, 64>& passwd
	){
		/*
		{salt, token} = login_to_token.find(login);
		if (was_unable_to_find){
			salt = random_generate();
			uint8_t tmp[128];
			memcpy(tmp, login, 64);
			memcpy(tmp+64, passwd, 32);
			memcpy(tmp+96m salt, 32);
			token = sha256(tmp);
			login_to_token.add(login: {salt, token});
			token_to_login.add(token: login);
			++id_counter;
			file_add_changes.add({login, salt, token});
			return token;
		}
		else {
			uint8_t tmp[128];
			memcpy(tmp, login, 64);
			memcpy(tmp+64, passwd, 32);
			memcpy(tmp+96, salt, 32);
			maybetoken = sha256(tmp);

			if (maybetoken == token){
				// SUCCESS
				return token;
			}
			else {
				// FAILED
				return std::array<uint8_t, 32>(0);
			}
		}
		*/
	}

	std::optional<const uint64_t> get_id(const std::array<uint8_t, 32> token) const {
		/*
		login = token_to_login.find(token);
		if (was_unable_to_find)
			return std::array>uint8_t, 64>(0);
		return login;
		*/
	}

	/* I just won't implement this
	const std::array<uint8_t, 32> new_token(
		const std::array<uint8_t, 64>& login,
		const std::array<uint8_t, 64>& passwd
	){
		{salt, token} = login_to_token.find(login);
		if (was_unable_to_find)
			return std::array>uint8_t, 32>(0);
		uint8_t tmp[128];
		memcpy(tmp, login, 64);
		memcpy(tmp+64, passwd, 32);
		memcpy(tmp+96, salt, 32);
		maybetoken = sha256(tmp);
		if (maybetoken != token){
			return std::array>uint8_t, 32>(255);
		}
	
		new_salt = random_generate();
		memcpy(tmp+96, new_salt, 32);
		new_token = sha256(tmp);

		login_to_token.change(login: {new_salt, new_token});
		token_to_login.remove(token: login);
		token_to_login.add(new_token: login);

		file_change_changes.add(
			{login, salt, token},
			{login, new_salt, new_token}
		);
		return new_token;
	
	}
	bool remove(
		const std::array<uint8_t, 64>& login,
		const std::array<uint8_t, 64>& passwd
	){
		{salt, token} = login_to_token.find(login);
		if (was_unable_to_find)
			return std::array>uint8_t, 32>(0);
		uint8_t tmp[128];
		memcpy(tmp, login, 64);
		memcpy(tmp+64, passwd, 32);
		memcpy(tmp+96, salt, 32);
		maybetoken = sha256(tmp);
		if (maybetoken != token){
			return false;
		}
		
		login_to_token.remove(login: {salt, token});
		token_to_login.remove(token: login)
		file_remove_changes.add(
			{login, salt, token}
		);
		return true;
	}
	*/
	void apply_changes(){
		/*
		file.append(file_add_changes as bytearray)
		file.close()
		file.open()
		file_add_changes.memset_zeroes();
		*/
	}
} authDB;