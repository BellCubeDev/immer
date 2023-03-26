"use strict"

import {measure} from "./measure.js"
import {
	enablePatches,
	produce,
	setAutoFreeze
} from "../dist/immer.esm.js"
import cloneDeep from "lodash.clonedeep"
import immutable from "immutable"
import Seamless from "seamless-immutable"
import deepFreeze from "deep-freeze"

const {List, Record} = immutable

function freeze(x) {
	Object.freeze(x)
	return x
}

const MAX = 50000
const MODIFY_FACTOR = 0.1
const baseState = []
let frozenBazeState
let immutableJsBaseState
let seamlessBaseState

// produce the base state
for (let i = 0; i < MAX; i++) {
	baseState.push({
		todo: "todo_" + i,
		done: false,
		someThingCompletelyIrrelevant: [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
	})
}

// Produce the frozen bazeState
frozenBazeState = deepFreeze(cloneDeep(baseState))

// generate immutalbeJS base state
const todoRecord = Record({
	todo: "",
	done: false,
	someThingCompletelyIrrelevant: []
})
immutableJsBaseState = List(baseState.map(todo => todoRecord(todo)))

// generate seamless-immutable base state
seamlessBaseState = Seamless.from(baseState)

console.log("\n# todo - performance\n")

measure(
	"just mutate",
	() => ({draft: cloneDeep(baseState)}),
	({draft}) => {
		for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
			draft[i].done = true
		}
	}
)

measure(
	"just mutate, freeze",
	() => ({draft: cloneDeep(baseState)}),
	({draft}) => {
		for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
			draft[i].done = true
		}
		deepFreeze(draft)
	}
)

measure("deepclone, then mutate", () => {
	const draft = cloneDeep(baseState)
	for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
		draft[i].done = true
	}
})

measure("deepclone, then mutate, then freeze", () => {
	const draft = cloneDeep(baseState)
	for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
		draft[i].done = true
	}
	deepFreeze(draft)
})

measure("handcrafted reducer (no freeze)", () => {
	const nextState = [
		...baseState.slice(0, MAX * MODIFY_FACTOR).map(todo => ({
			...todo,
			done: true
		})),
		...baseState.slice(MAX * MODIFY_FACTOR)
	]
})

measure("handcrafted reducer (with freeze)", () => {
	const nextState = freeze([
		...baseState.slice(0, MAX * MODIFY_FACTOR).map(todo =>
			freeze({
				...todo,
				done: true
			})
		),
		...baseState.slice(MAX * MODIFY_FACTOR)
	])
})

measure("naive handcrafted reducer (without freeze)", () => {
	const nextState = baseState.map((todo, index) => {
		if (index < MAX * MODIFY_FACTOR)
			return {
				...todo,
				done: true
			}
		else return todo
	})
})

measure("naive handcrafted reducer (with freeze)", () => {
	const nextState = deepFreeze(
		baseState.map((todo, index) => {
			if (index < MAX * MODIFY_FACTOR)
				return {
					...todo,
					done: true
				}
			else return todo
		})
	)
})

measure("immutableJS", () => {
	let state = immutableJsBaseState
	state.withMutations(state => {
		for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
			state.setIn([i, "done"], true)
		}
	})
})

measure("immutableJS + toJS", () => {
	let state = immutableJsBaseState
		.withMutations(state => {
			for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
				state.setIn([i, "done"], true)
			}
		})
		.toJS()
})

measure("seamless-immutable", () => {
	const state = seamlessBaseState
	state.map((todo, index) => {
		if (index < MAX * MODIFY_FACTOR) return todo.set("done", true)
		else return todo
	})
})

measure("seamless-immutable + asMutable", () => {
	const state = seamlessBaseState
	state
		.map((todo, index) => {
			if (index < MAX * MODIFY_FACTOR) return todo.set("done", true)
			else return todo
		})
		.asMutable({deep: true})
})

measure(
	"immer - without autofreeze",
	() => {
		setAutoFreeze(false)
	},
	() => {
		produce(baseState, draft => {
			for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
				draft[i].done = true
			}
		})
	}
)

measure(
	"immer - with autofreeze",
	() => {
		setAutoFreeze(true)
	},
	() => {
		produce(frozenBazeState, draft => {
			for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
				draft[i].done = true
			}
		})
	}
)

measure(
	"immer - without autofreeze - with patch listener",
	() => {
		enablePatches()
		setAutoFreeze(false)
	},
	() => {
		produce(
			baseState,
			draft => {
				for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
					draft[i].done = true
				}
			},
			function() {}
		)
	}
)

measure(
	"immer - with autofreeze - with patch listener",
	() => {
		enablePatches()
		setAutoFreeze(true)
	},
	() => {
		produce(
			baseState,
			draft => {
				for (let i = 0; i < MAX * MODIFY_FACTOR; i++) {
					draft[i].done = true
				}
			},
			function() {}
		)
	}
)
