import * as actions from "./Actions"
import { displayAiringDate, displayDate } from "./DateView"
import { findAll, delay, canUseWebP } from "./Utils"
import { Application } from "./Application"
import { Diff } from "./Diff"
import { MutationQueue } from "./MutationQueue"
import { StatusMessage } from "./StatusMessage"
import { PushManager } from "./PushManager"

export class AnimeNotifier {
	app: Application
	user: HTMLElement
	title: string
	webpEnabled: boolean
	contentLoadedActions: Promise<any>
	statusMessage: StatusMessage
	visibilityObserver: IntersectionObserver
	pushManager: PushManager

	imageFound: MutationQueue
	imageNotFound: MutationQueue
	unmount: MutationQueue

	constructor(app: Application) {
		this.app = app
		this.user = null
		this.title = "Anime Notifier"

		this.imageFound = new MutationQueue(elem => elem.classList.add("image-found"))
		this.imageNotFound = new MutationQueue(elem => elem.classList.add("image-not-found"))
		this.unmount = new MutationQueue(elem => elem.classList.remove("mounted"))

		if("IntersectionObserver" in window) {
			// Enable lazy load
			this.visibilityObserver = new IntersectionObserver(
				entries => {
					for(let entry of entries) {
						if(entry.intersectionRatio > 0) {
							entry.target["became visible"]()
							this.visibilityObserver.unobserve(entry.target)
						}
					}
				},
				{}
			)
		} else {
			// Disable lazy load feature
			this.visibilityObserver = {
				disconnect: () => {},
				observe: (elem: HTMLElement) => {
					elem["became visible"]()
				},
				unobserve: (elem: HTMLElement) => {}
			} as IntersectionObserver
		}
	}

	init() {
		document.addEventListener("readystatechange", this.onReadyStateChange.bind(this))
		document.addEventListener("DOMContentLoaded", this.onContentLoaded.bind(this))
		document.addEventListener("keydown", this.onKeyDown.bind(this), false)
		window.addEventListener("popstate", this.onPopState.bind(this))

		// Idle
		this.requestIdleCallback(this.onIdle.bind(this))
	}

	requestIdleCallback(func: Function) {
		if("requestIdleCallback" in window) {
			window["requestIdleCallback"](func)
		} else {
			func()
		}
	}

	onReadyStateChange() {
		if(document.readyState !== "interactive") {
			return
		}

		this.run()
	}

	run() {
		// Add "osx" class on macs so we can set a proper font-size
		if(navigator.platform.includes("Mac")) {
			document.documentElement.classList.add("osx")
		}

		// Check for WebP support
		this.webpEnabled = canUseWebP()

		// Initiate the elements we need
		this.user = this.app.find("user")
		this.app.content = this.app.find("content")
		this.app.loading = this.app.find("loading")

		// Status message
		this.statusMessage = new StatusMessage(
			this.app.find("status-message"),
			this.app.find("status-message-text")
		)

		// Let"s start
		this.app.run()

		// Service worker
		this.registerServiceWorker()

		// Push manager
		this.pushManager = new PushManager()
	}

	onContentLoaded() {
		// Stop watching all the objects from the previous page.
		this.visibilityObserver.disconnect()
		
		this.contentLoadedActions = Promise.all([
			Promise.resolve().then(() => this.mountMountables()),
			Promise.resolve().then(() => this.lazyLoadImages()),
			Promise.resolve().then(() => this.displayLocalDates()),
			Promise.resolve().then(() => this.setSelectBoxValue()),
			Promise.resolve().then(() => this.assignActions())
		])

		let headers = document.getElementsByTagName("h1")

		if(this.app.currentPath === "/" || headers.length === 0) {
			if(document.title !== this.title) {
				document.title = this.title
			}
		} else {
			document.title = headers[0].innerText
		}
	}

	onIdle() {
		this.pushAnalytics()
	}

	registerServiceWorker() {
		if(!("serviceWorker" in navigator)) {
			return
		}

		navigator.serviceWorker.register("/service-worker").then(registration => {
			registration.update()
		})

		navigator.serviceWorker.addEventListener("message", evt => {
			this.onServiceWorkerMessage(evt)
		})

		document.addEventListener("DOMContentLoaded", () => {
			if(!navigator.serviceWorker.controller) {
				return
			}

			let message = {
				type: "loaded",
				url: ""
			}

			if(this.app.lastRequest) {
				message.url = this.app.lastRequest.responseURL
			} else {
				message.url = window.location.href
			}

			navigator.serviceWorker.controller.postMessage(JSON.stringify(message))
		})
	}

	onServiceWorkerMessage(evt: ServiceWorkerMessageEvent) {
		let message = JSON.parse(evt.data)

		switch(message.type) {
			case "new content":
				if(message.url.includes("/_/")) {
					// Content reload
					this.contentLoadedActions.then(() => {
						this.reloadContent()
					})
				} else {
					// Full page reload
					this.contentLoadedActions.then(() => {
						this.reloadPage()
					})
				}
				
				break
		}
	}

	pushAnalytics() {
		if(!this.user) {
			return
		}

		let analytics = {
			general: {
				timezoneOffset: new Date().getTimezoneOffset()
			},
			screen: {
				width: screen.width,
				height: screen.height,
				availableWidth: screen.availWidth,
				availableHeight: screen.availHeight,
				pixelRatio: window.devicePixelRatio
			},
			system: {
				cpuCount: navigator.hardwareConcurrency,
				platform: navigator.platform
			}
		}

		fetch("/dark-flame-master", {
			method: "POST",
			credentials: "same-origin",
			body: JSON.stringify(analytics)
		})
	}

	setSelectBoxValue() {
		for(let element of document.getElementsByTagName("select")) {
			element.value = element.getAttribute("value")
		}
	}

	displayLocalDates() {
		const now = new Date()

		for(let element of findAll("utc-airing-date")) {
			displayAiringDate(element, now)
		}

		for(let element of findAll("utc-date")) {
			displayDate(element, now)
		}
	}

	reloadContent() {
		let headers = new Headers()
		headers.append("X-Reload", "true")

		let path = this.app.currentPath

		return fetch("/_" + path, {
			credentials: "same-origin",
			headers
		})
		.then(response => {
			if(this.app.currentPath !== path) {
				return Promise.reject("old request")
			}

			this.app.eTag = response.headers.get("ETag")
			return Promise.resolve(response)
		})
		.then(response => response.text())
		.then(html => Diff.innerHTML(this.app.content, html))
		.then(() => this.app.emit("DOMContentLoaded"))
	}

	reloadPage() {
		location.reload()
	}

	loading(isLoading: boolean) {
		if(isLoading) {
			document.body.style.cursor = "progress"
			this.app.loading.classList.remove(this.app.fadeOutClass)
		} else {
			document.body.style.cursor = "auto"
			this.app.loading.classList.add(this.app.fadeOutClass)
		}
	}
	
	assignActions() {
		for(let element of findAll("action")) {
			let actionTrigger = element.dataset.trigger
			let actionName = element.dataset.action

			let oldAction = element["action assigned"]

			if(oldAction) {
				if(oldAction.trigger === actionTrigger && oldAction.action === actionName) {
					continue
				}

				element.removeEventListener(oldAction.trigger, oldAction.handler)
			}

			let actionHandler = e => {
				actions[actionName](this, element, e)

				e.stopPropagation()
				e.preventDefault()
			}

			element.addEventListener(actionTrigger, actionHandler)

			// Use "action assigned" flag instead of removing the class.
			// This will make sure that DOM diffs which restore the class name
			// will not assign the action multiple times to the same element.
			element["action assigned"] = {
				trigger: actionTrigger,
				action: actionName,
				handler: actionHandler
			}
		}
	}

	lazyLoadImages() {
		for(let element of findAll("lazy")) {
			this.lazyLoadImage(element as HTMLImageElement)
		}
	}

	lazyLoadImage(img: HTMLImageElement) {
		// Once the image becomes visible, load it
		img["became visible"] = () => {
			// Replace URL with WebP if supported
			if(this.webpEnabled && img.dataset.webp) {
				let dot = img.dataset.src.lastIndexOf(".")
				img.src = img.dataset.src.substring(0, dot) + ".webp"
			} else {
				img.src = img.dataset.src
			}

			if(img.naturalWidth === 0) {
				img.onload = () => {
					this.imageFound.queue(img)
				}

				img.onerror = () => {
					this.imageNotFound.queue(img)
				}
			} else {
				this.imageFound.queue(img)
			}
		}

		this.visibilityObserver.observe(img)
	}

	mountMountables() {
		this.modifyDelayed("mountable", element => element.classList.add("mounted"))
	}

	unmountMountables() {
		for(let element of findAll("mountable")) {
			if(element.classList.contains("never-unmount")) {
				continue
			}

			this.unmount.queue(element)
		}
	}

	modifyDelayed(className: string, func: (element: HTMLElement) => void) {
		const delay = 20
		const maxDelay = 1000
		
		let time = 0
		let start = Date.now()
		let maxTime = start + maxDelay
		let collection = document.getElementsByClassName(className)
		let mutations = []

		let mountableTypes = {
			general: start
		}

		for(let i = 0; i < collection.length; i++) {
			let element = collection.item(i) as HTMLElement
			let type = element.dataset.mountableType || "general"

			if(type in mountableTypes) {
				time = mountableTypes[type] += delay
			} else {
				time = mountableTypes[type] = start
			}

			if(time > maxTime) {
				time = maxTime
			}

			mutations.push({
				element,
				time
			})
		}

		let mutationIndex = 0

		let updateBatch = () => {
			let now = Date.now()

			for(; mutationIndex < mutations.length; mutationIndex++) {
				let mutation = mutations[mutationIndex]

				if(mutation.time > now) {
					break
				}

				func(mutation.element)
			}

			if(mutationIndex < mutations.length) {
				window.requestAnimationFrame(updateBatch)
			}
		}

		window.requestAnimationFrame(updateBatch)
	}

	diff(url: string) {
		if(url === this.app.currentPath) {
			return Promise.reject(null)
		}

		let request = fetch("/_" + url, {
			credentials: "same-origin"
		})
		.then(response => {
			this.app.eTag = response.headers.get("ETag")
			return response.text()
		})
		
		history.pushState(url, null, url)
		this.app.currentPath = url
		this.app.markActiveLinks()
		this.unmountMountables()
		this.loading(true)

		// Delay by transition-speed
		return delay(300).then(() => {
			return request
			.then(html => this.app.setContent(html, true))
			.then(() => this.app.markActiveLinks())
			.then(() => this.app.emit("DOMContentLoaded"))
			.then(() => this.loading(false))
			.catch(console.error)
		})
	}

	post(url, obj) {
		return fetch(url, {
			method: "POST",
			body: JSON.stringify(obj),
			credentials: "same-origin"
		})
		.then(response => response.text())
		.then(body => {
			if(body !== "ok") {
				throw body
			}
		})
	}

	scrollTo(target: HTMLElement) {
		const duration = 250.0
		const steps = 60
		const interval = duration / steps
		const fullSin = Math.PI / 2
		const contentPadding = 24
		
		let scrollHandle: number
		let oldScroll = this.app.content.parentElement.scrollTop
		let newScroll = 0
		let finalScroll = Math.max(target.offsetTop - contentPadding, 0)
		let scrollDistance = finalScroll - oldScroll
		let timeStart = Date.now()
		let timeEnd = timeStart + duration

		let scroll = () => {
			let time = Date.now()
			let progress = (time - timeStart) / duration

			if(progress > 1.0) {
				progress = 1.0
			}

			newScroll = oldScroll + scrollDistance * Math.sin(progress * fullSin)
			this.app.content.parentElement.scrollTop = newScroll

			if(time < timeEnd && newScroll != finalScroll) {
				window.requestAnimationFrame(scroll)
			}
		}

		window.requestAnimationFrame(scroll)
	}

	findAPIEndpoint(element: HTMLElement) {
		let apiObject: HTMLElement
		let parent = element

		while(parent = parent.parentElement) {
			if(parent.dataset.api !== undefined) {
				apiObject = parent
				break
			}
		}

		if(!apiObject) {
			throw "API object not found"
		}

		return apiObject.dataset.api
	}

	onPopState(e: PopStateEvent) {
		if(e.state) {
			this.app.load(e.state, {
				addToHistory: false
			})
		} else if(this.app.currentPath !== this.app.originalPath) {
			this.app.load(this.app.originalPath, {
				addToHistory: false
			})
		}
	}

	onKeyDown(e: KeyboardEvent) {
		let activeElement = document.activeElement

		// Ignore hotkeys on input elements
		switch(activeElement.tagName) {
			case "INPUT":
			case "TEXTAREA":
				return
		}

		// Disallow Enter key in contenteditables
		if(activeElement.getAttribute("contenteditable") === "true" && e.keyCode == 13) {
			if("blur" in activeElement) {
				activeElement["blur"]()
			}
			
			e.preventDefault()
			e.stopPropagation()
			return
		}

		// F = Search
		if(e.keyCode == 70 && !e.ctrlKey) {
			let search = this.app.find("search") as HTMLInputElement

			search.focus()
			search.select()

			e.preventDefault()
			e.stopPropagation()
			return
		}
	}
}