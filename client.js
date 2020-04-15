'use strict'

const ws = require('websocket-stream')
const {
	createServer
} = require('net')
const pipe = require('pump')
const debug = require('debug')('tcp-over-websockets:client')
//const requestlib = require('request');
//"request": "^2.88.2",
//const parseString = require('xml2js').parseString;
//"xml2js": "^0.4.23"
const puppeteer = require('puppeteer');
const cfg = require('config.json')

const UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.163 Safari/537.36'
const log = (s) => console.log(s)

const sleep = (ms) => {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

var auth = null
var cookie = null

async function login() {
	// log(0)
	const browser = await puppeteer.launch({
		headless: false // Headless mode fails
	});
	// log(1)
	const page = await browser.newPage();
	await page.setViewport({
		width: 1280,
		height: 720
	})
	await page.setUserAgent(UserAgent)
	// log(2)
	await page.goto(cfg["login_url"])
	let sel_ckbox = '.checkbox--small'
	await page.waitForSelector(sel_ckbox)
	await page.click(sel_ckbox)
	let sel_uname = '[data-input-ctr-value="username"] input'
	//await page.waitForSelector(sel_uname)
	//	await page.click(sel_uname)
	//await sleep(1000)
	await page.$$eval(sel_uname, eles => eles[0].value = cfg['username'])
	await sleep(100)
	await page.click(sel_uname)
	let sel_pass = '[data-input-ctr-value="password"] input'
	//await page.waitForSelector(sel_pass)
	await page.$$eval(sel_pass, eles => eles[0].value = cfg['password'])
	await sleep(100)
	await page.click(sel_pass)
	let sel_btn = 'button[type="submit"]'
	await page.waitForSelector(sel_btn)
	let waitForTheResponse = (page, thiz) => {
		let resolved = false
		return Promise.race([new Promise((resolve) => {
			page.on('response', (res) => {
				if (resolved) return
				if (res.url().indexOf('login_psw.csp') >= 0) {
					resolved = true
					page.removeListener('response', thiz)
					resolve(res)
				}
			})
		}), new Promise((resolve, reject) => setTimeout(() => reject(), 5000))])
	}
	let resp = waitForTheResponse(page, waitForTheResponse)
	await page.click(sel_btn)
	resp = await resp
	resp = await resp.text()
	log(resp)
	if (resp.indexOf('Auth is success') >= 0)
		log('<> auth success')
	else log('<> auth problem')
	cookie = await page.cookies()
	log(cookie)
	await browser.close()
}

function establishInnerConnection(local, remote) {
	const onError = (err) => {
		if (err) {
			debug(err)
		}
	}
	pipe(remote, local, onError)
	pipe(local, remote, onError)
}

function headerifyCookie(cookie) {
	return cookie.map(i => `${i['name']}=${i['value']}`).join('; ')
}

function startClient(tunnel, target, port, cb) {

	const url = tunnel + (tunnel.slice(-1) === '/' ? '' : '/') + target

	const authenticate = async () => {
		auth = login()
		await auth
		auth = null
	}

	const makeConnectionToRemote = () => ws(url, {
		headers: {
			'Cookie': headerifyCookie(cookie),
			'User-Agent': UserAgent,
			'Referer': url,
		}
	})

	const tcpServer = createServer(async (local) => {
		// unlike thread, async calls won't break except at await statements.
		// if authenticating (in another concurrency entity) wait it to finish
		if (auth) await auth

		// if no cookie (initial) then authenticate first
		if (cookie == null) await authenticate()

		// try to make the connection
		let remote = makeConnectionToRemote()

		// if not authenticated we'll end up here
		remote.socket.once('unexpected-response', async (a, b) => {
			console.log('unexpected response')
			// now another concurrency entity may be already authenticating
			// if so, wait; otherwise do it here
			if (auth) await auth
			else await authenticate()
			// then connect discarding further failures
			let remote = makeConnectionToRemote()
			establishInnerConnection(local, remote)
		})

		// if authenticated & server up we'll end up here
		remote.socket.once('open', (a) => {
			console.log('opened')
			// simply connect
			establishInnerConnection(local, remote)
		})

		// consider other failures

		console.log('incoming')
	})

	tcpServer.listen(port, cb)
	return tcpServer
}

module.exports = startClient
