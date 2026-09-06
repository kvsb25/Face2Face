const { apiFetch, showErrors, safeNextPath } = window.F2FAuth;

const form = document.querySelector('#signup-form');
const submitBtn = document.querySelector('#submit');
const summaryEl = document.querySelector('#form-error');
const strengthBar = document.querySelector('#strength-bar');
const strengthLabel = document.querySelector('#strength-label');
const fieldEls = Object.fromEntries(
    [...document.querySelectorAll('.field-error')].map((el) => [el.dataset.for, el])
);

const MIN_LENGTH = 12;

// Mirrors the server's policy so the meter never promises something the server
// will reject. The server remains the authority; this is only feedback.
function scorePassword(value) {
    if (!value) return { score: 0, label: 'At least 12', colour: 'bg-slate-600' };
    if (value.length < MIN_LENGTH) return { score: 1, label: 'Too short', colour: 'bg-rose-500' };

    const distinct = new Set(value.toLowerCase()).size;
    if (distinct < 5) return { score: 1, label: 'Too repetitive', colour: 'bg-rose-500' };

    const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
    if (value.length >= 20 || variety >= 3) return { score: 4, label: 'Strong', colour: 'bg-emerald-500' };
    if (value.length >= 16 || variety >= 2) return { score: 3, label: 'Good', colour: 'bg-brand-500' };
    return { score: 2, label: 'Fair', colour: 'bg-amber-500' };
}

form.password.addEventListener('input', () => {
    const { score, label, colour } = scorePassword(form.password.value);
    strengthBar.className = `h-full rounded-full transition-all ${colour}`;
    strengthBar.style.width = `${(score / 4) * 100}%`;
    strengthLabel.textContent = label;
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitBtn.disabled = true;
    summaryEl.textContent = '';

    try {
        await apiFetch('/api/auth/signup', {
            method: 'POST',
            body: {
                email: form.email.value,
                password: form.password.value,
                displayName: form.displayName.value,
            },
        });
        window.location.href = safeNextPath();
    } catch (err) {
        showErrors(err, { summaryEl, fieldEls });
        submitBtn.disabled = false;
    }
});
