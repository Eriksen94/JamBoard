/********************************************************************/
/****************module imports and setup****************************/
/********************************************************************/

const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const crypto = require("crypto");

const http = require("http").Server(app);
const io = require("socket.io")(http);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

let gamePort = process.env.PORT || 3000;

/********************************************************************/
/**************************Server Variables**************************/
/********************************************************************/

//keep track or existing rooms on the server
let rooms = [];

const MAX_PLAYER_SUPPORT = 10;

const colourList = [
  "#ec1c27",
  "#4ebc85",
  "#f6881f",
  "#f8d522",
  "#168ab2",
  "#e65e9e",
  "#184722",
  "#6d3c97",
  "#211f5d",
  "#cab0d5",
];

/********************************************************************/
/**************************object structuring************************/
/********************************************************************/

//room structure for each socket room to contain lobby and game data
function Room(host) {
  this.hostID = host;
  //array of uuids present in the room, assigned on join
  this.clientsInLobby = new Array();
  this.game = new GameData();
  this.availableColours = new Array();
}

//game data that will be sent to and updated from clients to play the game in each room
function GameData() {
  this.rows = 5;
  this.cols = 5;
  this.currentPlayersTurn = 1; //1 indexed, turn numbers used to fill board, 0 is blank
  this.targetScore = 100;
  this.boardState = new Array();
  //can have repeats of a uuid in player data, that just means the same client is acting as multiple players
  this.players = new Array();
  this.complete = false;
  this.clientCount = 1;
  this.stage = "setup";
}

//player object to organize each in game player
//note one client can take the turns for multiple players
function Player(uuid, turnOrder, colour, score) {
  this.uuid = uuid;
  this.turnOrder = turnOrder;
  this.colour = colour;
  this.score = score;
}

/********************************************************************/
/**************************get routes********************************/
/********************************************************************/

//root route to join/create page
app.get("/", function (req, res) {
  res.sendFile(__dirname + "/views/home.html");
});

//lobby parameters for host vs join and optional join ID to be processed locally
//joinID is cut out and emitted to the socket for room connections
app.get("/lobby/:type/:joinID?", function (req, res) {
  res.sendFile(__dirname + "/views/game.html");
});

/********************************************************************/
/*************************post routes********************************/
/********************************************************************/

app.post("/host", function (req, res) {
  res.redirect("/lobby/host");
});

app.post("/join", function (req, res) {
  const requestedID = req.body.game_id;
  console.log("requested to join: " + requestedID);
  res.redirect("/lobby/join" + requestedID);
});

/********************************************************************/
/************************Socket setup********************************/
/********************************************************************/

//Create a socket.io instance using our express server
io.on("connection", (socket) => {
  console.log("a user is connected");

  //on connection give the user both a player id and host id
  const ids = {
    player: socket.id,
    host: crypto.randomBytes(2).toString("hex"),
  };
  socket.emit("on_connect", { player: ids.player, host: ids.host });
  console.log("assigned uuid: " + ids.player + " | game id: " + ids.host);

  //create a room on setup
  socket.on("host_setup", (id) => {
    socket.join(id.host);
    rooms.push(createRoom(id.host, id.player));
    console.log("hosted: " + id.host);
  });

  //join existing room or create new
  //id: join, player
  socket.on("join_lobby", (id) => {
    //join a room so that there is a unique channel to respond to if the id isn't found
    socket.join(id.join);
    console.log("joined: " + id.join);
    const roomInd = findRoomByHost(id.join);
    //room exists
    if (roomInd != -1) {
      rooms[roomInd].clientsInLobby.push(id.player);
      rooms[roomInd].game.clientCount = rooms[roomInd].clientsInLobby.length;
      //update colours if in setup
      if (rooms[roomInd].game.stage === "setup") {
        const colourData = {
          players: rooms[roomInd].game.players,
          availableColours: rooms[roomInd].availableColours,
          clientCount: rooms[roomInd].game.clientCount,
          stage: rooms[roomInd].game.stage,
        };
        io.to(id.join).emit("update_colours", colourData);
      }
      //update board otherwise
      else {
        io.to(id.join).emit("update_room", rooms[roomInd].game);
      }
    } else {
      //no match found by end of rooms search
      console.log("room not found");
      io.to(id.join).emit("send_home");
    }
  });

  //receive game setup data from a client - update game state for the room and emit to all members
  //params: host, rows, cols, playerCount, targetScore
  socket.on("game_setup", (gameParams) => {
    const roomInd = findRoomByHost(gameParams.host);
    if (roomInd != -1) {
      //save game params to room data, create players, a blank board, and list of player colours available
      initRoomGameData(gameParams, roomInd);
      //start the colour selector to re-assign player colours
      const setupParams = { game: rooms[roomInd].game, colours: colourList };
      io.to(gameParams.host).emit("start_setup", setupParams);
    } else {
      console.log("room not found to setup game");
    }
  });

  //check if colour is available and assign it to the player/remove from available array
  //emit signal to update availability and draw to canvas
  //params: host: room name, turn: of player object that is trying to have a colour assigned, colour: to be assigned
  socket.on("colour_selected", (selectParams) => {
    const roomInd = findRoomByHost(selectParams.host);
    if (roomInd != -1) {
      //save game params to room data, create players and a blank board
      const pickMade = pickColour(
        roomInd,
        selectParams.turn,
        selectParams.colour
      );
      console.log(pickMade);
      if (pickMade) {
        const colourData = {
          players: rooms[roomInd].game.players,
          availableColours: rooms[roomInd].availableColours,
          clientCount: rooms[roomInd].game.clientCount,
          stage: rooms[roomInd].game.stage,
        };
        console.log(colourData);
        io.to(selectParams.host).emit("update_colours", colourData);
      }
    } else {
      console.log("room not found to pick colour");
    }
  });

  //after all players have been assigned a colour - start the actual game
  //params: host: room name 
  //all other parameters already sent during setup to initialize room data and pick colours
  socket.on("game_started", (gameParams) => {
    const roomInd = findRoomByHost(gameParams.host);
    if (roomInd != -1) {
      //save game params to room data, create players and a blank board
      rooms[roomInd].game.stage = "playing";
      io.to(gameParams.host).emit("update_room", rooms[roomInd].game);
    } else {
      console.log("room not found to begin game");
    }
  });

  //receive data for a move played from a client and play the move
  //params: host, row, col
  socket.on("move_played", (moveParams) => {
    const roomInd = findRoomByHost(moveParams.host);
    if (roomInd != -1) {
      //check it is the clients turn, if so, check the move is valid, if so update board and score, inc turn
      const movePlayed = playMoveInRoom(
        socket.id,
        moveParams.row,
        moveParams.col,
        roomInd
      );
      if (movePlayed) {
        io.to(moveParams.host).emit("update_room", rooms[roomInd].game);
      }
    } else {
      console.log("room not found for this move");
    }
  });

  //remove players and rooms that aren't needed on client disconnect
  socket.on("disconnecting", () => {
    if (socket.rooms.size > 1) {
      console.log(socket.rooms);
      console.log(socket.id);
      const roomInfo = Array.from(socket.rooms);
      const roomName = roomInfo[1];
      const roomInd = findRoomByHost(roomName);
      if (roomInd != -1) {
        //last client in room - remove room object from array
        if (rooms[roomInd].clientsInLobby.length === 1) {
          rooms.splice(roomInd, 1);
        }
        //other clients - just remove client
        else {
          //remove from client list and reassign turns to the host
          clearPlayerFromRoom(socket.id, roomInd);
          //emit to other sockets in the same room
          rooms[roomInd].game.clientCount =
            rooms[roomInd].clientsInLobby.length;
          io.to(roomName).emit("update_room", rooms[roomInd].game);
          console.log(rooms);
        }
      } else {
        console.log("no room data found");
      }
    }
  });
}); //socket server section end

/********************************************************************/
/**************************Open Server*******************************/
/********************************************************************/

const server = http.listen(gamePort, () => {
  console.log("server is running on port: ", server.address().port);
});

/********************************************************************/
/**************************Convenience*******************************/
/********************************************************************/

//provide the name of a socket room and return the index
//for the room array which holds the corresponding game data
function findRoomByHost(id) {
  let found = -1;
  for (let i = 0; i < rooms.length; i++) {
    //room found to exist - join
    if (rooms[i].hostID === id) {
      found = i;
      break;
    }
  }
  return found;
}

//create a template Room object, ensuring the board array is setup/filled
//so that the client won't receive an empty array
function createRoom(host, player) {
  let r = new Room(host);
  r.clientsInLobby.push(player);
  r.game.boardState = [[0]];
  //create blank board
  r.game.boardState.length = 0;
  let tempBoard = new Array();
  for (let i = 0; i < r.game.rows; i++) {
    let a = new Array(r.game.cols);
    for (let j = 0; j < r.game.cols; ++j) a[j] = 0;
    tempBoard.push(a);
  }
  r.game.boardState = tempBoard;
  return r;
}

//remove a player from a specific room object
//find all instances of the players turn and assign those turns to the host
//remove the player from the client list for future turn updates
function clearPlayerFromRoom(playerId, roomInd) {
  //remove from the client list
  const pInd = rooms[roomInd].clientsInLobby.indexOf(playerId);
  if (pInd > -1) {
    rooms[roomInd].clientsInLobby.splice(pInd, 1);
  }

  //remove and re-assign turns to host - allows game to continue
  //when setting up a new game having removed them from client list is sufficient
  for (let i = 0; i < rooms[roomInd].game.players.length; i++) {
    if (rooms[roomInd].game.players[i].uuid === playerId) {
      rooms[roomInd].game.players[i].uuid = rooms[roomInd].clientsInLobby[0];
    }
  }
}

//find the index of the players array which holds a player object with a turn order matching the turn
function findPlayerByTurn(turn, players) {
  let playerInd = -1;
  for (let i = 0; i < players.length; i++) {
    if (players[i].turnOrder === turn) {
      playerInd = i;
      break;
    }
  }
  return playerInd;
}

/* Randomize array in-place using Durstenfeld shuffle algorithm */
function shuffleArray(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

/********************************************************************/
/**************************Game Functions****************************/
/********************************************************************/

function pickColour(roomInd, turn, colour) {
  let pickMade = false;
  const availInd = rooms[roomInd].availableColours.indexOf(colour);
  const playerInd = findPlayerByTurn(turn, rooms[roomInd].game.players);
  console.log({ t: availInd, c: playerInd });
  if (availInd > -1 && playerInd > -1) {
    rooms[roomInd].game.players[playerInd].colour = colour;
    rooms[roomInd].availableColours.splice(availInd, 1);
    pickMade = true;
  }
  return pickMade;
}

//setup the room data for  the item at the ind called:
//save parameters, create a random turn order,
//allowing multiple players to play from the same client
//clear and setup a blank board array to be played on
//params: rows, cols, playerCount, targetScore
function initRoomGameData(params, ind) {
  rooms[ind].game.rows = parseInt(params.rows);
  rooms[ind].game.cols = parseInt(params.cols);
  rooms[ind].game.targetScore = parseFloat(params.targetScore);
  rooms[ind].game.complete = false;
  rooms[ind].game.currentPlayersTurn = 1;
  rooms[ind].game.stage = "setup";

  //setup available colour list
  rooms[ind].availableColours.length = 0;
  for (let i = 0; i < colourList.length; i++) {
    rooms[ind].availableColours.push(colourList[i]);
  }

  //cap player size
  playersInGame = parseInt(params.playerCount);
  if (playersInGame > MAX_PLAYER_SUPPORT) {
    playersInGame = MAX_PLAYER_SUPPORT;
  }

  //create array of shuffled player order
  let order = new Array();
  for (let j = 0; j < playersInGame; j++) {
    order.push(j + 1);
  }
  shuffleArray(order);

  //create player objects - allow for multiple players from the same client
  rooms[ind].game.players.length = 0;
  let k = 0;
  for (let j = 0; j < playersInGame; j++) {
    if (k >= rooms[ind].clientsInLobby.length) {
      k = 0;
    }
    //player - id, turnOrder (1 indexed), colour, score
    let p = new Player(rooms[ind].clientsInLobby[k], order[j], "#FFF", 0);
    rooms[ind].game.players.push(p);
    k++;
  }

  //create blank board
  rooms[ind].game.boardState.length = 0;
  let tempBoard = new Array();
  for (let i = 0; i < rooms[ind].game.rows; i++) {
    let a = new Array(rooms[ind].game.cols);
    for (let j = 0; j < rooms[ind].game.cols; ++j) a[j] = 0;
    tempBoard.push(a);
  }
  rooms[ind].game.boardState = tempBoard;
}

//check it is the clients turn, if so, check the move is valid, if so update board and score, inc turn
//check if the board is full and game is over
function playMoveInRoom(playerNum, row, col, roomInd) {
  if (rooms[roomInd].game.complete) {
    console.log("game is complete - can't play move");
    return false;
  }

  //check for current players turn
  const turn = rooms[roomInd].game.currentPlayersTurn;
  let turnMatch = false;
  let matchedPlayer = 0;
  for (let i = 0; i < rooms[roomInd].game.players.length; i++) {
    if (
      turn === rooms[roomInd].game.players[i].turnOrder &&
      playerNum === rooms[roomInd].game.players[i].uuid
    ) {
      turnMatch = true;
      matchedPlayer = i;
    }
  }

  let validMove = false;
  //check move is valid
  if (
    turnMatch &&
    row >= 0 &&
    row < rooms[roomInd].game.rows &&
    col >= 0 &&
    col < rooms[roomInd].game.cols
  ) {
    //check board space is available
    if (rooms[roomInd].game.boardState[row][col] === 0) {
      validMove = true;
    } else {
      console.log("space is already full");
    }
  } else {
    console.log("not your turn/invalid move");
  }

  //update board and score move
  if (validMove) {
    rooms[roomInd].game.boardState[row][col] = turn;
    rooms[roomInd].game.players[matchedPlayer].score += scoreMove(
      row,
      col,
      turn,
      rooms[roomInd].game.boardState
    );
    rooms[roomInd].game.currentPlayersTurn++;
    //loop turns
    if (
      rooms[roomInd].game.currentPlayersTurn >
      rooms[roomInd].game.players.length
    )
      rooms[roomInd].game.currentPlayersTurn = 1;
    rooms[roomInd].game.complete = checkIfGameComplete(
      rooms[roomInd].game.boardState
    );
  }

  return validMove;
}

//each tile is worth (row x col)
//vertical adjacent tiles from other players add to your score
//horizontal adjacent tiles from other players subtract your score
function scoreMove(row, col, playerNum, board, verbose = false) {
  const move = { row: row, col: col };
  let firstCheck = 0;
  let addToScore = (row + 1) * (col + 1);

  //check above
  for (let i = row - 1; i >= 0; i--) {
    //empty square or player square, not considered
    if (board[i][move.col] === 0 || board[i][move.col] === playerNum) {
      break;
    }
    //save first entry to see if the next is the same - must be non-zero and not players square to get this far
    if (i === move.row - 1) {
      firstCheck = board[i][move.col];
      addToScore += (i + 1) * (move.col + 1);
    }
    //subsequent checks only add if it matches the first valid addition
    else if (board[i][move.col] === firstCheck) {
      addToScore += (i + 1) * (move.col + 1);
    }
    //not the first check, and not matching the value from the first check so it must be a different player square
    //stop counting
    else {
      break;
    }
  }
  if (verbose) console.log("above score: " + addToScore);

  //check below
  for (let i = move.row + 1; i < board.length; i++) {
    //empty square or player square, not considered
    if (board[i][move.col] === 0 || board[i][move.col] === playerNum) {
      break;
    }
    //save first entry to see if the next is the same - must be non-zero and not players square to get this far
    if (i === move.row + 1) {
      firstCheck = board[i][move.col];
      addToScore += (i + 1) * (move.col + 1);
    }
    //subsequent checks only add if it matches the first valid addition
    else if (board[i][move.col] === firstCheck) {
      addToScore += (i + 1) * (move.col + 1);
    }
    //not the first check, and not matching the value from the first check so it must be a different player square
    //stop counting
    else {
      break;
    }
  }
  if (verbose) console.log("above and below score: " + addToScore);
  //check right
  for (let i = move.col + 1; i < board[0].length; i++) {
    //empty square or player square, not considered
    if (board[move.row][i] === 0 || board[move.row][i] === playerNum) {
      break;
    }
    //save first entry to see if the next is the same - must be non-zero and not players square to get this far
    if (i === move.col + 1) {
      firstCheck = board[move.row][i];
      addToScore -= (i + 1) * (move.row + 1);
    }
    //subsequent checks only add if it matches the first valid addition
    else if (board[move.row][i] === firstCheck) {
      addToScore -= (i + 1) * (move.row + 1);
    }
    //not the first check, and not matching the value from the first check so it must be a different player square
    //stop counting
    else {
      break;
    }
  }
  if (verbose) console.log("above, below, right score: " + addToScore);

  //check left 3,5
  for (let i = move.col - 1; i >= 0; i--) {
    //empty square or player square, not considered
    if (board[move.row][i] === 0 || board[move.row][i] === playerNum) {
      break;
    }
    //save first entry to see if the next is the same - must be non-zero and not players square to get this far
    if (i === move.col - 1) {
      firstCheck = board[move.row][i];
      addToScore -= (i + 1) * (move.row + 1);
    }
    //subsequent checks only add if it matches the first valid addition
    else if (board[move.row][i] === firstCheck) {
      addToScore -= (i + 1) * (move.row + 1);
    }
    //not the first check, and not matching the value from the first check so it must be a different player square
    //stop counting
    else {
      break;
    }
  }
  if (verbose) console.log("above, below, right. left score: " + addToScore);

  return addToScore;
}

//iterate through a board array to see if every space is non 0
//if so the board is full and the game is over - return complete
function checkIfGameComplete(board) {
  let complete = false;
  let emptyCount = 0;
  for (let i = 0; i < board.length; i++) {
    for (let j = 0; j < board[0].length; j++) {
      if (board[i][j] == 0) {
        emptyCount++;
        break;
      }
    }
  }
  if (emptyCount === 0) {
    complete = true;
  }
  return complete;
}
