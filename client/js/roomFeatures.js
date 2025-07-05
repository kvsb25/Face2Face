let userName;
const messageBox = document.querySelector('#message');
const sendMsgBtn = document.querySelector('#send-message');
const chatBox = document.querySelector('#chat-box');
const sendFileBtn = document.querySelector('#send-file');
const fileInput = document.querySelector('#file-input');

function sendMessageHandler(dataChannel) {
  const message = messageBox.value;
  addChat(userName, message);
  const payload = {
    type: 'message',
    user: userName,
    message
  }
  console.log(`payload: ${payload}`);
  dataChannel.send(JSON.stringify(payload));
}

function sendFileHandler(dataChannel, fileSend) {
  fileSend = true;
  const file = fileInput.files[0];
  const chunkSize = 16 * 1024;
  let offset = 0;

  const reader = new FileReader();
  
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.textContent = file.name;
  a.click();
  addChat(userName, a.outerHTML);

  const payload = {
    type: 'file',
    user: userName,
  }
  console.log('payload 1: ', { ...payload, fileChunk: file.name, EOF: false }); // EOF: end of file
  dataChannel.send(JSON.stringify({ ...payload, fileChunk: file.name, EOF: false }));

  reader.onload = e => {
    console.log('payload 2: ', { ...payload, fileChunk: e.target.result, EOF: false });
    dataChannel.send(JSON.stringify({ ...payload, fileChunk: e.target.result, EOF: false }));
    offset += chunkSize;
    if (offset < file.size) {
      readSlice(offset);
    } else {
      console.log('payload 3: ', { ...payload, fileChunk: "EOF", EOF: true });
      dataChannel.send(JSON.stringify({ ...payload, fileChunk: "EOF", EOF: true }));
      fileSend = false;
    }
  };

  function readSlice(o) {
    const slice = file.slice(o, o + chunkSize);
    reader.readAsArrayBuffer(slice);
  }

  readSlice(0);
}

function addChat(user, message) {
  const chatHTML = chatComponent(message);
  console.log('in addChat, chatHTML: ', chatHTML);
  const chatElement = stringToElement(chatHTML);
  console.log('in addChat, chatElement: ', chatElement);
  if (user == userName) {
    chatElement.classList.add('self-chat');
  } else {
    chatElement.classList.add('remote-chat');
  }
  console.log(chatElement.classList);
  chatBox.appendChild(chatElement);
}

const chatComponent = (message) => {
  console.log('in chatComponent, message: ',message);
  return `<div class="chat">
                <span id="user"></span>
                <span id="chat-message">${message}</span>
            </div>`
}

const stringToElement = (html) => {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}