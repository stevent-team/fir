import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'

import { PathSegment, RecursivePartial, fieldChain, getDeepProp, setDeepProp, unwrapZodType, deepEqual, FormatSchemaFields, isCheckbox, isRadio } from './utils'

export interface UseFormOptions<Schema extends z.AnyZodObject> {
  /** The zod schema to use when parsing the values. */
  schema: Schema
  /** Initialise the fields with values. By default they will be set to undefined. */
  initialValues?: RecursivePartial<z.infer<Schema>>
}

export type SubmitHandler<Schema extends z.AnyZodObject> = (values: z.infer<Schema>) => void

export type RegisterFn = (path: PathSegment[], schema: z.ZodType) => {
  onChange: React.ChangeEventHandler<any>
  ref: React.LegacyRef<any>
  name: string
}

/**
 * Hook used to control a form. Takes configuration options and returns an object with state and methods.
 */
export const useForm = <Schema extends z.AnyZodObject>({
  schema,
  initialValues = {},
}: UseFormOptions<Schema>) => {
  const [formValue, setFormValue] = useState(structuredClone(initialValues))
  const [formErrors, setFormErrors] = useState<z.ZodError<z.infer<Schema>>>()
  const fieldRefs = useRef<Record<string, { path: PathSegment[], ref: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement }>>({})

  // Whether or not to validate fields when anything changes
  const [validateOnChange, setValidateOnChange] = useState(false)

  // Keep track of the initial form values to calculate isDirty
  const [internalInitialValues, setInternalInitialValues] = useState(structuredClone(initialValues))
  const isDirty = useMemo(() => !deepEqual(formValue, internalInitialValues), [formValue, internalInitialValues])

  const reset = useCallback((values: RecursivePartial<z.infer<Schema>> = initialValues) => {
    setInternalInitialValues(values)
    setFormValue(values)
  }, [initialValues])

  // Validate by parsing form data with zod schema, and return parsed data if valid
  const validate = useCallback(async () => {
    const parsed = await schema.safeParseAsync(formValue)
    if (parsed.success) {
      setFormErrors(undefined)
      return parsed.data
    } else {
      setFormErrors(parsed.error)
    }
  }, [schema, formValue])

  // Watch for changes in value
  useEffect(() => {
    if (validateOnChange) validate()

    // Set registered field values
    Object.values(fieldRefs.current).forEach(({ path, ref }) => {
      const value = getDeepProp(formValue, path) as string | boolean | undefined
      if (isRadio(ref)) {
        if (ref.value === value) {
          ref.checked = true
        } else {
          ref.checked = false
        }
      } else if (isCheckbox(ref)) {
        ref.checked = Boolean(value)
      } else {
        ref.value = String(value ?? '')
      }
    })
  }, [formValue, validateOnChange, validate])

  // Submit handler
  const handleSubmit = useCallback((handler: SubmitHandler<Schema>): React.FormEventHandler<HTMLFormElement> => async e => {
    e.preventDefault()
    e.stopPropagation()
    const values = await validate()
    if (values) handler(values)
    setValidateOnChange(true)
  }, [validate])

  // Register for native elements (input, textarea, select)
  const register = useCallback<RegisterFn>((path, fieldSchema) => {
    const name = path.map(p => p.key).join('.')
    const unwrapped = unwrapZodType(fieldSchema)

    return {
      onChange: e => {
        let newValue: string | boolean | undefined = e.currentTarget.value
        if (!(unwrapped instanceof z.ZodString) && newValue === '') {
          newValue = undefined
        }
        if (e.currentTarget.type?.toLowerCase() === 'checkbox') {
          newValue = e.currentTarget.checked
        }
        setFormValue(v => setDeepProp(v, path, newValue) as typeof v)
      },
      name,
      ref: ref => {
        if (ref) {
          const refIndex = isRadio(ref) ? `${name}.${ref.value}` : name
          fieldRefs.current[refIndex] = { path, ref }
        } else {
          delete fieldRefs.current[name]
        }
      },
    } satisfies React.ComponentProps<'input'>
  }, [formValue])

  const fields = useMemo(() => new Proxy(schema.shape, {
    get: (_target, key) => fieldChain(schema, [], register, { formValue, setFormValue, formErrors })[key]
  }) as FormatSchemaFields<Schema, {
    /**
     * Provides props to pass to native elements (input, textarea, select)
     *
     * @example
     * <input type="text" {...fields.firstName.register()} />
     */
    register: () => ReturnType<RegisterFn>
    /**
     * Get the name of this field used by the register function.
     *
     * @example
     * <label htmlFor={field.firstName.name()}>First name</label>
     */
    name: () => string
  }>, [schema, register, formValue, formErrors])

  return {
    /** Access zod schema and registration functions for your fields. */
    fields,
    /**
     * Higher-order function that intercepts a form's onSubmit event and gives you the values, after validating with the provided zod schema.
     *
     * @example
     * const onSubmit: SubmitHandler<typeof schema> = values => console.log(values)
     *
     * return <form onSubmit={submitHandler(onSubmit)}>
     */
    handleSubmit,
    /** Will check if the form values are not deeply equal with the initialValues passed in the config or provided via `reset()`. */
    isDirty,
    /** Reset the form with provided values, or with initialValues if nothing is passed. */
    reset,
    value: formValue,
  }
}
