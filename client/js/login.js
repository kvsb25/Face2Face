const { apiFetch, showErrors, safeNextPath } = window.F2FAuth;

const form = document.querySelector('#login-form');
const submitBtn = document.querySelector('#submit');
const summaryEl = document.querySelector('#form-error');
const fieldEls = Object.fromEntries(
    [...document.querySelectorAll('.field-error')].map((el) => [el.dataset.for, el])
);

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitBtn.disabled = true;
    summaryEl.textContent = '';

    try {
        await apiFetch('/api/auth/login', {
            method: 'POST',
            body: {
                email: form.email.value,
                password: form.password.value,
            },
        });
        window.location.href = safeNextPath();
    } catch (err) {
        showErrors(err, { summaryEl, fieldEls });
        submitBtn.disabled = false;
        form.password.value = '';
        form.password.focus();
    }
});
