const { apiFetch, fetchCurrentUser } = window.F2FAuth;

const select = document.querySelector.bind(document);
const input = select("#roomID");
const joinBtn = select("#joinRoom");
const errorBox = select(".error");
const createBtn = select("#createRoom");
const createSignInLink = select("#createRoomSignIn");
const accountName = select("#account-name");
const signOutBtn = select("#sign-out");
const signInLink = select("#sign-in-link");

// show the reason when redirected back here (e.g. from a full room's URL)
const errorReasons = {
    room_full: "Can't join, the room is full",
    no_room: "no such room exists",
    server: "some server issue, try again later"
};
const errorParam = new URLSearchParams(window.location.search).get('error');
if (errorParam) {
    errorBox.textContent = errorReasons[errorParam] || 'something went wrong';
}

// Joining stays open to everyone; only creating a room needs an account, and
// the server enforces that regardless of what this page shows.
fetchCurrentUser().then(renderAuthState);

function renderAuthState(user) {
    const signedIn = Boolean(user);

    createBtn.classList.toggle('hidden', !signedIn);
    createSignInLink.classList.toggle('hidden', signedIn);
    signInLink.classList.toggle('hidden', signedIn);
    signOutBtn.classList.toggle('hidden', !signedIn);
    accountName.classList.toggle('hidden', !signedIn);

    if (signedIn) {
        // display names come from other people's input: set as text, never HTML
        accountName.textContent = user.displayName;
    }
}

signOutBtn.addEventListener('click', async () => {
    signOutBtn.disabled = true;
    try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
        console.warn('sign out failed:', err.message);
    }
    window.location.reload();
});

joinBtn.addEventListener('click', joinRoomHandler);
createBtn.addEventListener('click', createRoomHandler);

// Enter in the room code box joins, matching the button next to it
input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        joinBtn.click();
    }
});

async function joinRoomHandler() {
    disableBtn(joinBtn);
    errorBox.textContent = '';

    const roomId = input.value.trim().toLowerCase();
    try {
        const data = await apiFetch(`/api/room?roomId=${encodeURIComponent(roomId)}`);
        window.location.href = `/room/${data.roomId}`;
    } catch (err) {
        errorBox.textContent = `can't join room: ${err.message}`;
    }
}

async function createRoomHandler() {
    disableBtn(createBtn);
    errorBox.textContent = '';

    try {
        const data = await apiFetch('/api/room', { method: 'POST' });
        window.location.href = `/room/${data.roomId}`;
    } catch (err) {
        if (err.status === 401) {
            window.location.href = '/login?next=/';
            return;
        }
        errorBox.textContent = `can't create room: ${err.message}`;
    }
}

function disableBtn(btn) {
    btn.disabled = true;
    setTimeout(() => {
        btn.disabled = false;
    }, 1500);
}
