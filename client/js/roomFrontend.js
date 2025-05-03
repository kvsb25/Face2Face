let userName;
const messageBox = document.querySelector('#message');
const sendMsgBtn = document.querySelector('#send-message');
const chatBox = document.querySelector('#chat-box');

function sendMessageHandler(dataChannel) {
  const message = messageBox.value;
  addChat(userName, message);
  const payload = {
    user: userName,
    message
  }
  console.log(`payload: ${payload}`);
  dataChannel.send(JSON.stringify(payload));
}

function addChat(user, message) {
  const chatHTML = chatComponent(message);
  const chatElement = stringToElement(chatHTML);
  console.log('userName: ',user);
  console.log('user == userName', user==userName);
  if(user == userName){
    chatElement.classList.add('self-chat');
  } else {
    chatElement.classList.add('remote-chat');
  }
  console.log(chatElement.classList);
  chatBox.appendChild(chatElement);
}

const chatComponent = (message) => {
  return `<div class="chat">
                <span id="user"></span>
                <span id="chat-message">${message}</span>
            </div>`
}
// const chatComponent = (message) => {
//   return `<div class="chat remote-chat">
//                 <span id="user"></span>
//                 <span id="chat-message">${message}</span>
//             </div>`
// }
// const chatComponent = (message) => {
//   return `<div class="chat remote-chat">
//                 <span id="user"></span>
//                 <span id="chat-message">${message}</span>
//             </div>`
// }

const stringToElement = (html) => {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}