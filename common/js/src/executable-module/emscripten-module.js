/** @license
 * Copyright 2020 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview This file contains helper definitions that can be used for
 * loading and interacting with an Emscripten/WebAssembly module.
 */

goog.provide('GoogleSmartCard.EmscriptenModule');

goog.require('GoogleSmartCard.Logging');
goog.require('GoogleSmartCard.TypedMessage');
goog.require('goog.Disposable');
goog.require('goog.html.TrustedResourceUrl');
goog.require('goog.log.Logger');
goog.require('goog.messaging.AbstractChannel');
goog.require('goog.net.jsloader');
goog.require('goog.string.Const');

goog.scope(function() {

const GSC = GoogleSmartCard;

const LOGGER_SCOPE = 'EmscriptenModule';
const WRAPPER_SUBLOGGER_SCOPE = 'Wrapper';

/**
 * Class that allows to load and run the Emscripten module with the given name
 * and exchange messages with it.
 * @constructor
 * @extends goog.Disposable
 */
GSC.EmscriptenModule = function(moduleName) {
  EmscriptenModule.base(this, 'constructor');

  /** @type {string} @const @private */
  this.moduleName_ = moduleName;
  /** @type {!goog.log.Logger} @const @private */
  this.fromModuleMessagesLogger_ = GSC.Logging.getScopedLogger(LOGGER_SCOPE);
  /** @type {!goog.log.Logger} @const */
  this.logger = GSC.Logging.getChildLogger(
      this.fromModuleMessagesLogger_, WRAPPER_SUBLOGGER_SCOPE);
  /** @type {!EmscriptenModuleMessageChannel} @const */
  this.messageChannel = new EmscriptenModuleMessageChannel;
  // Object that is an entry point on the C++ side and is used for exchanging
  // messages with it. Untyped, since the class "GoogleSmartCardModule" is
  // defined within the Emscripten module (using Embind) and therefore isn't
  // known to Closure Compiler.
  /** @private */
  this.googleSmartCardModule_ = null;
};

const EmscriptenModule = GSC.EmscriptenModule;
goog.inherits(EmscriptenModule, goog.Disposable);

/**
 * Starts loading the Emscripten module.
 */
EmscriptenModule.prototype.startLoading = function() {
  this.load_().catch((e) => {
    this.logger.warning('Failed to load the Emscripten module: ' + e);
    this.dispose();
  });
};

/** @override */
EmscriptenModule.prototype.disposeInternal = function() {
  this.logger.fine('Disposed');
  delete this.googleSmartCardModule_;
  this.messageChannel.dispose();
  EmscriptenModule.base(this, 'disposeInternal');
};

/**
 * Asynchronously loads and executes the Emscripten module.
 * @return {!Promise<void>}
 * @private
 */
EmscriptenModule.prototype.load_ = async function() {
  // First step: Asynchronously load the JS file containing the runtime support
  // code autogenerated by Emscripten. By convention (see build rules in
  // //common/make/internal/executable_building_emscripten.mk), the file's base
  // name is the module name.
  const jsUrl = goog.html.TrustedResourceUrl.format(goog.string.Const.from(
      '/%{moduleName}.js'), {'moduleName': this.moduleName_});
  await goog.net.jsloader.safeLoad(jsUrl);

  // Second step: Run the factory function that asynchronously loads the
  // Emscripten module and creates the Emscripten API's Module object. By
  // convention (see the EXPORT_NAME parameter in
  // //common/make/internal/executable_building_emscripten.mk), the function has
  // a specific name based on the module name.
  const factoryFunction = goog.global[
      `loadEmscriptenModule_${this.moduleName_}`];
  GSC.Logging.checkWithLogger(this.logger, factoryFunction,
                              'Emscripten factory function not defined');
  // TODO(#220): Handle module crashes.
  const emscriptenApiModule = await factoryFunction();

  // Third step: Create the object that serves as an entry point on the C++
  // side and is used for exchanging messages with it. By convention (see the
  // entry_point_emscripten.cc files), the class is named GoogleSmartCardModule.
  const GoogleSmartCardModule = emscriptenApiModule['GoogleSmartCardModule'];
  GSC.Logging.checkWithLogger(this.logger, GoogleSmartCardModule,
                              'GoogleSmartCardModule class not defined');
  this.googleSmartCardModule_ = new GoogleSmartCardModule((message) => {
    this.messageChannel.onMessageFromModule(message);
  });

  // Wire up outgoing messages with the module.
  this.messageChannel.onModuleCreated(this.googleSmartCardModule_);
};

/**
 * @constructor
 * @extends goog.messaging.AbstractChannel
 * @package
 */
function EmscriptenModuleMessageChannel() {
  goog.messaging.AbstractChannel.call(this);
  /** @type {!Array<!Object>} @private */
  this.pendingOutgoingMessages_ = [];
  // Instance of the "GoogleSmartCardModule" class that is defined via Embind.
  /** @private */
  this.googleSmartCardModule_ = null;
}

goog.inherits(EmscriptenModuleMessageChannel, goog.messaging.AbstractChannel);

/** @override */
EmscriptenModuleMessageChannel.prototype.send = function(serviceName, payload) {
  GSC.Logging.check(goog.isObject(payload));
  goog.asserts.assertObject(payload);
  const typedMessage = new GSC.TypedMessage(serviceName, payload);
  const message = typedMessage.makeMessage();
  if (this.isDisposed())
    return;
  if (!this.googleSmartCardModule_ || this.pendingOutgoingMessages_.length) {
    // Enqueue the message: either the module isn't fully loaded yet or we're
    // still sending the previously enqueued messages to it.
    this.pendingOutgoingMessages_.push(message);
    return;
  }
  this.sendNow_(message);
};

/** @override */
EmscriptenModuleMessageChannel.prototype.disposeInternal = function() {
  delete this.googleSmartCardModule_;
  EmscriptenModuleMessageChannel.base(this, 'disposeInternal');
};

/**
 * @param {?} googleSmartCardModule
 * @package
 */
EmscriptenModuleMessageChannel.prototype.onModuleCreated =
    function(googleSmartCardModule) {
  this.googleSmartCardModule_ = googleSmartCardModule;
  // Send all previously enqueued messages. Note that, in theory, new items
  // might be added to the array while we're iterating over it, which should be
  // fine as the for-of loop will visit all of them.
  for (const message of this.pendingOutgoingMessages_)
    this.sendNow_(message);
  this.pendingOutgoingMessages_ = [];
};

/**
 * @param {?} message
 * @package
 */
EmscriptenModuleMessageChannel.prototype.onMessageFromModule =
    function(message) {
  const typedMessage = GSC.TypedMessage.parseTypedMessage(message);
  if (!typedMessage) {
    GSC.Logging.fail(
        'Failed to parse message received from Emscripten module: ' +
        GSC.DebugDump.debugDump(message));
  }
  this.deliver(typedMessage.type, typedMessage.data);
};

/**
 * @param {!Object} message
 * @private
 */
EmscriptenModuleMessageChannel.prototype.sendNow_ = function(message) {
  // Note: The method name must match the string in the GoogleSmartCardModule
  // Embind class definition in the entry_point_emscripten.cc files.
  this.googleSmartCardModule_['postMessage'](message);
};

});  // goog.scope
