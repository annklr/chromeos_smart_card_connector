// Copyright 2016 Google Inc.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions
// are met:
//
// 1. Redistributions of source code must retain the above copyright
//    notice, this list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
// 3. The name of the author may not be used to endorse or promote products
//    derived from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
// IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
// OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
// IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
// INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
// NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
// THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

#ifndef GOOGLE_SMART_CARD_THIRD_PARTY_PCSC_LITE_SERVER_SOCKETS_MANAGER_H_
#define GOOGLE_SMART_CARD_THIRD_PARTY_PCSC_LITE_SERVER_SOCKETS_MANAGER_H_

#include <condition_variable>
#include <mutex>
#include <queue>

#include "common/cpp/src/public/optional.h"

namespace google_smart_card {

// Holder of a queue of server-side sockets for the socket pairs created at the
// client side.
//
// This class allows to implement on the server side the operation of waiting
// until any client creates a new socket pair to the server.
class PcscLiteServerSocketsManager final {
 public:
  // Note: This function is not thread-safe!
  static void CreateGlobalInstance();
  // Note: This function is not thread-safe!
  static void DestroyGlobalInstance();
  // Note: This function is not thread-safe!
  static PcscLiteServerSocketsManager* GetInstance();

  // Inserts the descriptor into the wait queue.
  void Push(int server_socket_file_descriptor);

  // Returns the next descriptor from the wait queue. When the queue is empty,
  // waits in a blocking way until an item appears in it. If the class is shut
  // down, exits with a null optional instead.
  optional<int> WaitAndPop();

  // Switches into the "shutting down" state. This makes all ongoing and future
  // `WaitAndPop()` calls return a null optional.
  void ShutDown();

 private:
  PcscLiteServerSocketsManager();
  PcscLiteServerSocketsManager(const PcscLiteServerSocketsManager&) = delete;
  PcscLiteServerSocketsManager& operator=(const PcscLiteServerSocketsManager&) =
      delete;
  ~PcscLiteServerSocketsManager();

  std::mutex mutex_;
  std::condition_variable condition_;
  bool shutting_down_ = false;
  std::queue<int> server_socket_file_descriptors_queue_;
};

}  // namespace google_smart_card

#endif  // GOOGLE_SMART_CARD_THIRD_PARTY_PCSC_LITE_SERVER_SOCKETS_MANAGER_H_
