import { action, createAtom, IAtom } from "mobx"
import { fastGetParentPath, ParentPath } from "../parent/path"
import { isPrimitive } from "../utils"

/**
 * @internal
 */
export type SnapshotTransformFn = (sn: unknown) => unknown

interface SnapshotData {
  untransformed: any
  readonly transformFn: SnapshotTransformFn | undefined
  transformed: any
  readonly atom: IAtom
}

const snapshots = new WeakMap<Object, SnapshotData>()

// true if it has been accessed publicly and therefore should be cloned
// rather than modified in place
const frozenState = new WeakMap<Object, boolean>()

/**
 * @internal
 */
export function getInternalSnapshot<T extends object>(
  value: T
): Readonly<SnapshotData> | undefined {
  return snapshots.get(value)
}

interface InternalSnapshotParent {
  parentSnapshot: SnapshotData | undefined
  parentPath: ParentPath<any>
}

function getInternalSnapshotParent(
  sn: Readonly<SnapshotData> | undefined,
  parentPath: ParentPath<any> | undefined
): InternalSnapshotParent | undefined {
  if (!parentPath || !sn) {
    return undefined
  }

  const parentSn = getInternalSnapshot(parentPath.parent)
  if (!parentSn) {
    return undefined
  }

  return {
    parentSnapshot: parentSn,
    parentPath: parentPath,
  }
}

/**
 * @internal
 */
export const unsetInternalSnapshot = action("unsetInternalSnapshot", (value: any) => {
  const oldSn = getInternalSnapshot(value)

  if (oldSn) {
    snapshots.delete(value)
    oldSn.atom.reportChanged()
  }
})

/**
 * @internal
 */
export const setNewInternalSnapshot = action(
  "setNewInternalSnapshot",
  <T extends object>(
    value: any,
    untransformed: T,
    transformFn: SnapshotTransformFn | undefined,
    markAsFrozen = false
  ): void => {
    const sn: SnapshotData = {
      untransformed,
      transformFn,
      transformed: transformFn ? transformFn(untransformed) : untransformed,
      atom: createAtom("snapshot"),
    }
    frozenState.set(sn.untransformed, markAsFrozen)
    frozenState.set(sn.transformed, markAsFrozen)

    snapshots.set(value, sn)

    sn.atom.reportChanged()
  }
)

type MutateInternalSnapshotFn<T> = (prevSn: T) => void

/**
 * @internal
 */
export const updateInternalSnapshot = action(
  "updateInternalSnapshot",
  <T extends object>(value: any, mutate: MutateInternalSnapshotFn<T>): void => {
    const sn = getInternalSnapshot(value)! as SnapshotData

    let untransformed = sn.untransformed
    const snFrozen = frozenState.get(untransformed)!
    if (snFrozen) {
      if (Array.isArray(untransformed)) {
        untransformed = untransformed.slice()
      } else {
        untransformed = Object.assign({}, untransformed)
      }
    }

    mutate(untransformed)

    sn.untransformed = untransformed
    sn.transformed = sn.transformFn ? sn.transformFn(untransformed) : untransformed

    frozenState.set(sn.untransformed, false)
    frozenState.set(sn.transformed, false)

    sn.atom.reportChanged()

    // also update parent(s) snapshot(s) if needed
    const parent = getInternalSnapshotParent(sn, fastGetParentPath(value))
    if (parent) {
      const { parentSnapshot, parentPath } = parent
      // might be false in the cases where the parent has not yet been created
      if (parentSnapshot) {
        const path = parentPath.path

        // patches for parent changes should not be emitted
        updateInternalSnapshot(parentPath.parent, (objOrArray: any) => {
          objOrArray[path] = sn.transformed
        })
      }
    }
  }
)

/**
 * @internal
 */
export function reportInternalSnapshotObserved(sn: SnapshotData) {
  sn.atom.reportObserved()
}

/**
 * @internal
 */
export function freezeInternalSnapshot<T>(data: T): T {
  if (isPrimitive(data)) {
    return data
  }

  // this might be undefined if the data comes from example from transforms
  const isFrozen = frozenState.get(data)

  if (isFrozen === undefined || isFrozen === true) {
    // already frozen or an external data (e.g. from a transform)
    return data
  }

  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      freezeInternalSnapshot(data[i])
    }
  } else {
    const keys = Object.keys(data)
    for (let i = 0; i < keys.length; i++) {
      freezeInternalSnapshot((data as any)[keys[i]])
    }
  }

  frozenState.set(data, true)

  return data
}
