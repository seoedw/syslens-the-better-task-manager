'use strict';
// Runs as a worker. Edge and Chrome slow a hidden window's own timers down to as little as once
// a minute, but not a worker's, so this 1 s tick keeps reconnecting on schedule in the background.
setInterval(() => postMessage(0), 1000);
