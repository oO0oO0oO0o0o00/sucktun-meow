'use strict'

const {
	createConnection
} = require('net')
const {
	createServer: createHttpServer
} = require('http')
const url = require('url')
const {
	createServer: createWsServer
} = require('websocket-stream')
const pump = require('pump')
const debug = require('debug')('tcp-over-websockets:server')

const verifyRequest = (req, res) => {
	if (req.upgrade) return
	res.statusCode = 405
	res.end('connect via WebSocket protocol')
}

// using a helper function can help normalize things
var readSocket = (socket, nb, cb) => {
	var r = socket.read(nb);
	if (r === null) {
		socket.once('readable', function() {
			var r = socket.read(nb);
			cb(r);
		});
		return;
	}
	cb(r);
}

const startServer = (port, cb) => {
	const httpServer = createHttpServer(verifyRequest)

	const verifyClient = ({
		req
	}, cb) => {
		const target = url.parse(req.url).pathname.slice(1)
		const [hostname, port] = target.split(':')
		req.tunnelPort = +port
		req.tunnelHostname = hostname
		cb(!isNaN(port) && hostname, 400, 'invalid target')
	}

	const wsServer = createWsServer({
		server: httpServer,
		verifyClient
	}, (remote, req) => {
		// readSocket(remote, 4, (r) => {
		// 	if (r != 'meow') {
		// 		remote.write('fuck you are not a cat')
		// 		req.destroy()
		// 		return
		// 	}
		const target = createConnection(req.tunnelPort, req.tunnelHostname)
		target.on('error', console.error)

		const onStreamError = (err) => {
			if (err) debug(err)
		}
		target.once('connect', () => {
			pump(remote, target, onStreamError)
			pump(target, remote, onStreamError)
		})
		//})
	})

	httpServer.listen(port, cb)
	return {
		httpServer,
		wsServer
	}
}

module.exports = startServer
