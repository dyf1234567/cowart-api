// Embedded browsers may suppress window.prompt; use a real, accessible DOM form.
export function requestCanvasInput(label) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.style.cssText = 'width:min(560px,90vw);padding:24px;border-radius:12px;z-index:100000'
    const form = document.createElement('form')
    const field = document.createElement('label')
    field.textContent = label
    const input = document.createElement('textarea')
    input.setAttribute('aria-label', label)
    input.style.cssText = 'display:block;width:100%;min-height:100px;margin:16px 0;box-sizing:border-box'
    input.required = true
    field.append(input)
    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.textContent = '继续'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = '取消'
    let value = null
    form.onsubmit = (event) => { event.preventDefault(); value = input.value.trim(); dialog.close() }
    cancel.onclick = () => dialog.close()
    dialog.addEventListener('close', () => { dialog.remove(); resolve(value) }, { once: true })
    form.append(field, submit, cancel)
    dialog.append(form)
    document.body.append(dialog)
    dialog.showModal()
    input.focus()
  })
}
