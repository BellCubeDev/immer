import {
	ImmerScope,
	DRAFT_STATE,
	isDraftable,
	NOTHING,
	PatchPath,
	each,
	has,
	freeze,
	ImmerState,
	isDraft,
	SetState,
	set,
	ArchType,
	getPlugin,
	die,
	revokeScope,
	isFrozen,
} from "../internal"

export function processResult(
	result: any,
	scope: ImmerScope
) {
	scope.unfinalizedDrafts_ = scope.drafts_.length
	const baseDraft = scope.drafts_![0]
	const isReplaced = result !== undefined && result !== baseDraft
	if (isReplaced) {
		if (baseDraft[DRAFT_STATE].modified_) {
			revokeScope(scope)
			die(4)
		}
		if (isDraftable(result)) {
			// Finalize the result in case it contains (or is) a subset of the draft.
			result = finalize(scope, result)
			if (!scope.parent_) maybeFreeze(scope, result, false)
		}
		if (scope.patches_) {
			getPlugin("Patches").generateReplacementPatches_(
				baseDraft[DRAFT_STATE].base_,
				result,
				scope.patches_,
				scope.inversePatches_!
			)
		}
	} else {
		// Finalize the base draft.
		result = finalize(scope, baseDraft, [])
	}
	revokeScope(scope)
	if (scope.patches_) {
		scope.patchListener_!(scope.patches_, scope.inversePatches_!)
	}
	return result !== NOTHING ? result : undefined
}

function finalize(
	rootScope: ImmerScope,
	value: any,
	path?: PatchPath,
	encounteredObjects = new WeakSet<any>()
): any {
	let state: ImmerState | undefined = value[DRAFT_STATE]

	// Never finalize drafts owned by another scope.
	if (state && state.scope_ !== rootScope) return value

	// Don't recurse into recursive data structures
	if (isFrozen(value) || encounteredObjects.has(state ? state.base_ : value)) return state ? (state.modified_? state.copy_ : state.base_) : value
	encounteredObjects.add(state ? state.base_ : value)


	// A plain object, might need freezing, might contain drafts
	if (!state || (!state.modified_ && state.scope_.existingStateMap_)) {
		each(
			value,
			(key, childValue) =>
				finalizeProperty(
					rootScope,
					state,
					value,
					key,
					childValue,
					path,
					undefined,
					encounteredObjects
				)
		)
		return state ? (state.copy_ ? state.copy_ : state.base_) : value
	}
	// Unmodified draft, return the (frozen) original
	if (!state.modified_) {
		maybeFreeze(rootScope, state.copy_ ?? state.base_, true)
		return state.base_
	}
	// Not finalized yet, let's do that now
	if (!state.finalized_) {
		state.finalized_ = true
		state.scope_.unfinalizedDrafts_--
		const result = state.copy_
		// Finalize all children of the copy
		// For sets we clone before iterating, otherwise we can get in endless loop due to modifying during iteration, see #628
		// To preserve insertion order in all cases we then clear the set
		// And we let finalizeProperty know it needs to re-add non-draft children back to the target
		let resultEach = result
		let isSet = false
		if (state.type_ === ArchType.Set) {
			resultEach = new Set(result)
			result.clear()
			isSet = true
		}
		each(resultEach, (key, childValue) =>
			finalizeProperty(
				rootScope,
				state,
				result,
				key,
				childValue,
				path,
				isSet,
				encounteredObjects
			)
		)
		// everything inside is frozen, we can freeze here
		maybeFreeze(rootScope, result, false)
		// first time finalizing, let's create those patches
		if (path && rootScope.patches_) {
			getPlugin("Patches").generatePatches_(
				state,
				path,
				rootScope.patches_,
				rootScope.inversePatches_!
			)
		}
	}

	return state.copy_
}

function finalizeProperty(
	rootScope: ImmerScope,
	parentState: undefined | ImmerState,
	targetObject: any,
	prop: string | number,
	childValue: any,
	rootPath?: PatchPath,
	targetIsSet?: boolean,
	encounteredObjects = new WeakSet<any>()
) {
	if (process.env.NODE_ENV !== "production" && childValue === targetObject)
		die(5)

	if (!isDraft(childValue) && isDraftable(childValue)) {
		const existingState = rootScope.existingStateMap_?.get(childValue)
		if (existingState) {
			childValue = existingState.draft_
		}
	}

	if (isDraft(childValue)) {
		const path =
			rootPath &&
			parentState &&
			parentState!.type_ !== ArchType.Set && // Set objects are atomic since they have no keys.
			!has((parentState as Exclude<ImmerState, SetState>).assigned_!, prop) // Skip deep patches for assigned keys.
				? rootPath!.concat(prop)
				: undefined
		// Drafts owned by `scope` are finalized here.
		const res = finalize(rootScope, childValue, path, encounteredObjects)
		set(targetObject, prop, res)
		// Drafts from another scope must prevented to be frozen
		// if we got a draft back from finalize, we're in a nested produce and shouldn't freeze
		if (isDraft(res)) {
			rootScope.canAutoFreeze_ = false
		} else return
	} else if (targetIsSet) {
		targetObject.add(childValue)
	}

	// Search new objects for unfinalized drafts. Frozen objects should never contain drafts.
	if (isDraftable(childValue) && !isFrozen(childValue)) {
		if (!rootScope.immer_.autoFreeze_ && rootScope.unfinalizedDrafts_ < 1) {
			// optimization: if an object is not a draft, and we don't have to
			// deepfreeze everything, and we are sure that no drafts are left in the remaining object
			// cause we saw and finalized all drafts already; we can stop visiting the rest of the tree.
			// This benefits especially adding large data tree's without further processing.
			// See add-data.js perf test
			return
		}
		finalize(
			rootScope,
			childValue,
			undefined,
			encounteredObjects
		)
		// Immer deep freezes plain objects, so if there is no parent state, we freeze as well
		// Per #590, we never freeze symbolic properties. Just to make sure don't accidentally interfere
		// with other frameworks.
		if (
			(!parentState || !parentState.scope_.parent_) &&
			typeof prop !== "symbol" &&
			Object.prototype.propertyIsEnumerable.call(targetObject, prop)
		)
			maybeFreeze(rootScope, childValue)
	}
}

function maybeFreeze(scope: ImmerScope, value: any, deep = false) {
	// we never freeze for a non-root scope; as it would prevent pruning for drafts inside wrapping objects
	if (!scope.parent_ && scope.immer_.autoFreeze_ && scope.canAutoFreeze_) {
		freeze(value, deep)
	}
}
