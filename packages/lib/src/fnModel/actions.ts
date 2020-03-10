import { ActionContextActionType } from "../action/context"
import { isModelAction } from "../action/modelAction"
import { flow, isModelFlow } from "../action/modelFlow"
import { wrapInAction } from "../action/wrapInAction"
import { assertIsFunction, failure, logWarning } from "../utils"
import { assertFnModelKeyNotInUse, FnModelFn } from "./core"

const fnModelActionRegistry = new Map<string, FnModelFn<any, FnModelActionDef>>()

/**
 * @ignore
 * @internal
 */
export function getFnModelAction(actionName: string) {
  return fnModelActionRegistry.get(actionName)
}

/**
 * Functional model action definition.
 */
export type FnModelActionDef = (...args: any[]) => any

/**
 * An object with functional model action definitions.
 */
export interface FnModelActionsDef {
  [k: string]: FnModelActionDef
}

/**
 * Functional model actions.
 */
export type FnModelActions<Data extends object, ActionsDef extends FnModelActionsDef> = {
  [k in keyof ActionsDef]: FnModelFn<Data, ActionsDef[k]>
}

/**
 * @ignore
 * @internal
 */
export function extendFnModelActions(
  fnModelObj: any,
  namespace: string,
  actions: FnModelActionsDef
): any {
  for (const [name, fn] of Object.entries(actions)) {
    addActionToFnModel(fnModelObj, namespace, name, fn, false)
  }

  return fnModelObj
}

/**
 * @ignore
 * @internal
 */
export function addActionToFnModel<Data>(
  fnModelObj: any,
  namespace: string,
  name: string,
  fn: (...args: any[]) => any,
  isFlow: boolean
): void {
  assertFnModelKeyNotInUse(fnModelObj, name)

  const fullActionName = `${namespace}::${name}`

  assertIsFunction(fn, fullActionName)

  if (fnModelActionRegistry.has(fullActionName)) {
    logWarning(
      "warn",
      `an standalone action with name "${fullActionName}" already exists (if you are using hot-reloading you may safely ignore this warning)`,
      `duplicateActionName - ${name}`
    )
  }

  if (isModelAction(fn)) {
    throw failure("the standalone action must not be previously marked as an action")
  }
  if (isModelFlow(fn)) {
    throw failure("the standalone action must not be previously marked as a flow action")
  }

  const wrappedAction = isFlow
    ? flow(fullActionName, fn)
    : wrapInAction({
        name: fullActionName,
        fn,
        actionType: ActionContextActionType.Sync,
      })

  fnModelObj[name] = (target: Data, ...args: any[]) => wrappedAction.apply(target, args)
  fnModelActionRegistry.set(fullActionName, fnModelObj[name])
}
