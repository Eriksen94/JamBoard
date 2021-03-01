/********************************************************************/
/*************************client variables***************************/
/********************************************************************/
let debug = false;

//script variables that display and govern game state
var canvas = document.getElementById("viewport");
var canvasCtx = canvas.getContext("2d");
var gameData = {
  size: { rows: 5, cols: 5 },
  boardState: new Array(),
  currentPlayersTurn: 1,
  players: new Array(),
  targetScore: 100,
  hostID: "",
  playerID: "",
  inLobby: 1,
  suggestedScore: 100
};

//player object
function Player(uuid, turnOrder, colour, score) {
  this.uuid = uuid;
  this.turnOrder = turnOrder;
  this.colour = colour;
  this.score = score;
}

//connect to socket IO instance on the server - socket IO script files must be loaded in HTML as well
var socket = io();

//socket based functions that the server will initiate
socket.on("on_connect", handleConnection);
socket.on("update_room", updateGame);
socket.on("send_home", sendHome);

/********************************************************************/
/*******************socket processing functions**********************/
/********************************************************************/
//receive game data from the server to update local gameData object
//data: rows, cols, currentPlayersTurn, targetScore, boardState, players, complete, clientCount
function updateGame(data) {
  if (debug) console.log(data);
  //server converts numbers to strings, need to make sure data is stored properly
  gameData.inLobby = parseInt(data.clientCount);
  cols = parseInt(data.cols);
  rows = parseInt(data.rows);
  gameData.currentPlayersTurn = parseInt(data.currentPlayersTurn);
  gameData.targetScore = parseFloat(data.targetScore);
  //re-draw board and set up array for copying
  gameData.size.cols = cols;
  gameData.size.rows = rows;
  gameData.boardState.length = 0;
  gameData.boardState = drawBoard(gameData.size);

  //copy board state from the data to local storage
  for (let x = 0; x < gameData.boardState.length; x++) {
    for (let y = 0; y < gameData.boardState[0].length; y++) {
      gameData.boardState[x][y] = parseInt(data.boardState[x][y]);
    }
  }

  //copy player info
  gameData.players.length = 0;
  for (let x = 0; x < data.players.length; x++) {
    let p = new Player(
      data.players[x].uuid,
      parseInt(data.players[x].turnOrder),
      data.players[x].colour,
      parseInt(data.players[x].score)
    );
    gameData.players.push(p);
  }

  fillBoard(gameData.currentPlayersTurn, gameData.boardState, gameData.players, debug);

  updateGameDisplay();

  displayScores(gameData.players);

  //check if the board is full - declare winner
  if (checkComplete(gameData.boardState)) {
    displayWinner(checkWinner(gameData.players, gameData.targetScore, debug), debug);
  }

  if(debug) console.log(gameData);
}

//check if a player is joining as host or to an existing lobby
//emit socket events for the server to correctly allocate rooms for future socket communication
//params: ids {host: , player: } - IDs that are assigned when a socket connection is established
function handleConnection(ids) {
  if (debug) console.log(ids);
  gameData.hostID = ids.host;
  gameData.playerID = ids.player;

  //url is lobby/host or lobby/join:gameID depending on previous selection
  let path = window.location.pathname;
  //hosting
  if (path.includes("host")) {
    let setupID = { host: gameData.hostID, player: gameData.playerID };
    socket.emit("host_setup", setupID);
    if (debug) console.log(setupID);
    $("#lobby-num").html("Lobby id: " + gameData.hostID);
  }
  //joining
  else {
    let joinRequest = path.substring(path.lastIndexOf("/") + 5, path.length); //+5 for "join" offset
    socket.emit("join_lobby", { join: joinRequest, player: gameData.playerID });
    if (debug) console.log(joinRequest);
    gameData.hostID = joinRequest;
    $("#lobby-num").html("Lobby id: " + gameData.hostID);
  }
}

//send to homepage when attempting to join a host that doesn't exist
function sendHome() {
  window.location.href = window.location.origin;
}

/********************************************************************/
/********************event processing functions**********************/
/********************************************************************/

//client script so the setup button won't redirect/reload the page
//setup the canvas for play, based on the input boxes
$(() => {
  $("#setup-btn").click(function () {
    //clear any existing game data and update display for immediate feedback
    clearGameData();
    gameData.size.rows = $("#rows").val();
    gameData.size.cols = $("#cols").val();
    let playerCount = $("#playerCount").val();
    for (let i = 0; i < playerCount; i++) {
      gameData.players.push(new Player("", i+1,"",0));
    }
    gameData.targetScore = $("#targetScore").val();
    gameData.boardState = drawBoard(gameData.size);
    $("#turnInd").html("Player 1 start");
    $("#scoreDisplay").html("");

    //emit to the server so that it can re-emit to all the other sockets in the same room and update them as well
    let setupData = {
      host: gameData.hostID,
      rows: gameData.size.rows,
      cols: gameData.size.cols,
      playerCount: playerCount,
      targetScore: gameData.targetScore,
    };
    socket.emit("game_setup", setupData);
  });
});

//listener to check where a mouse click is on canvas (scaled for css size changes)
//check turn vs client id and allow for game action to occur
//update game state based on click and send to server to update other connected sockets
canvas.addEventListener("mousedown", function (e) {
  let myTurn = false;
  //check if the turn id matches with this players id
  for (let i = 0; i < gameData.players.length; i++) {
    if (
      gameData.currentPlayersTurn === gameData.players[i].turnOrder &&
      gameData.playerID === gameData.players[i].uuid
    ) {
      myTurn = true;
    }
  }

  if (myTurn) {
    //check click position on canvas
    let t = getMousePos(canvas, e);
    //validate move, update board array data and calc score locally for responsiveness
    let s = boardClick(
      t,
      gameData.boardState,
      gameData.currentPlayersTurn,
      debug
    );
    if (debug) console.log("click for: ");
    if (debug) console.log(s);
    gameData.players[gameData.currentPlayersTurn - 1].score += s.score;

    //move to next turn
    if (s.updated) gameData.currentPlayersTurn++;
    if (gameData.currentPlayersTurn > gameData.players.length) {
      gameData.currentPlayersTurn = 1;
    }

    //calls update functions through socket
    //emit to the server so that it can re-emit to all sockets in this room and update them as well (including this one)
    //client side sockets don't have rooms
    if (s.updated) {
      let moveData = {
        host: gameData.hostID,
        row: s.row,
        col: s.col,
      };
      socket.emit("move_played", moveData);
    }
  } else {
    if (debug) console.log("not your turn");
  }
});

//return mouse position on a canvas from a mousedown event listener - scaled for css size changes
//0,0 is top left of canvas. Does not handle any rotation or translation of co-ord system
function getMousePos(canvas, evt, verbose = false) {
  let rect = canvas.getBoundingClientRect(), // abs. size of element
    scaleX = canvas.width / rect.width, // relationship bitmap vs. element for X
    scaleY = canvas.height / rect.height; // relationship bitmap vs. element for Y
  let coord = {
    x: (evt.clientX - rect.left) * scaleX, // scale mouse coordinates after they have
    y: (evt.clientY - rect.top) * scaleY, // been adjusted to be relative to element
  };
  if (verbose) console.log(coord.x + "," + coord.y);
  return coord;
}

$("#rows").change(() => {estimateTarget()});
$("#cols").change(() => {estimateTarget()});
$("#playerCount").change(() => {estimateTarget()});

//provide a score target estimate - sum of all possible moves / num of players
function estimateTarget(){
  const r = $("#rows").val();
  const c = $("#cols").val();
  const p = $("#playerCount").val();
  let sum = 0;
  for(let i = 1; i <= r; i++){
    for(let j = 1; j <= c; j++){
      sum += i*j;
    }
  }
  $("#targetScore").val(Math.round(sum/p * 10) / 10);
}

/********************************************************************/
/*********************game play/setup functions**********************/
/********************************************************************/

//draw grid lines on the canvas
//return array of 0s for the size passed in
//params: size {rows: ..., cols: ...}
//canvasCtx is script scoped
function drawBoard(size, verbose = false) {
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  canvasCtx.beginPath();
  let ht = canvas.height;
  let wd = canvas.width;

  let rowHt = Math.floor(ht / size.rows);
  let colWd = Math.floor(wd / size.cols);

  for (let x = rowHt; x < ht - rowHt + 1; x += rowHt) {
    canvasCtx.moveTo(0, x);
    canvasCtx.lineTo(wd, x);
    if (verbose) console.log("line: 0," + x + " to " + wd + "," + x);
  }

  for (let x = colWd; x < wd - colWd + 1; x += colWd) {
    canvasCtx.moveTo(x, 0);
    canvasCtx.lineTo(x, ht);
    if (verbose) console.log("line: " + x + ",0 to " + x + "," + ht);
  }

  canvasCtx.strokeStyle = "#FFFFFF";
  canvasCtx.lineWidth = 2;
  canvasCtx.stroke();

  let tempBoard = new Array();
  for (let i = 0; i < size.rows; i++) {
    let a = new Array(size.cols);
    for (let j = 0; j < size.cols; ++j) a[j] = 0;
    if (verbose) console.log(a);
    tempBoard.push(a);
  }
  if (verbose) console.log(tempBoard);
  return tempBoard;
}

//colour in boxes on the canvas based on the array indicating board state
//params: boardState[rows][cols] - 0 = blank, otherwise filled with player id
//playersArr[] {uuid: , id: , colour} - match id and colour for fill colour
function fillBoard(currentTurn, boardState, playersArr, verbose = false) {
  //board state - 2d array of rows and cols indicating filled or blank
  let ht = canvas.height;
  let wd = canvas.width;

  let rowHt = Math.floor(ht / boardState.length); //number of lists = rows
  let colWd = Math.floor(wd / boardState[0].length); //length of row = cols

  for (let x = 0; x < boardState.length; x++) {
    for (let j = 0; j < boardState[0].length; j++) {
      //space has been played on - colour code it
      if (boardState[x][j] > 0) {
        for (let k = 0; k < playersArr.length; k++) {
          if (boardState[x][j] === playersArr[k].turnOrder) {
            canvasCtx.fillStyle = playersArr[k].colour;
            break;
          }
        }
        //identify coordinates, then fill
        let xStart = colWd * j;
        let yStart = rowHt * x;
        let adjust = [1, 1, -2, -2]; //2px grid lines
        if (x === 0) {
          //first row - no top line offset, start pos up 1px, ht inc 1px
          adjust[1] = 0;
          adjust[3] = -1;
        }
        if (j === 0) {
          //first col - no left line, start pos left 1px, wd inc 1px
          adjust[0] = 0;
          adjust[2] = -1;
        }
        if (x === boardState.length-1){
          //last row - inc row ht to fill edge
          const htRemainder = ht % rowHt;
          adjust[3] = htRemainder - 1;
        }
        if (j === boardState[0].length-1){
          //last column - inc col wd to fill edge
          const colRemainder = wd % colWd;
          adjust[2] = colRemainder - 1;
        }
        canvasCtx.fillRect(
          xStart + adjust[0],
          yStart + adjust[1],
          colWd + adjust[2],
          rowHt + adjust[3]
        ); //adjustments for line thickness

        if (verbose)
          console.log(
            "ret: " + xStart + "," + yStart + "," + colWd + "," + rowHt
          );
      }
      //space is empty - write in the potential value for the current players turn
      else{
        scorePot = scoreMove(currentTurn, {row: x, col: j}, boardState);
        let xStart = colWd * j;
        let yStart = rowHt * x;
        canvasCtx.fillStyle = "#FFF";
        let potStr = "" + scorePot;
        canvasCtx.fillText(potStr, xStart + 5, yStart + 10);
      }
    }
  }
}

//check which grid space a click on the canvas occurred in
//if the space is available update the board state for the player
//return: score of the move, if a move was accepted, and the row/col index of the move {score: , updated: , row: , col:}
//update script scope board state - draw updated board elsewhere
//Params: clickPos = {x: , y: } scaled position of the cursor when pressed down on canvas element, calculated in event listener
//boardState[rows][cols] - array of board state 0 or player id
//playerID - turn number for the player that made the click - enforce turn requirements elsewhere
function boardClick(clickPos, boardState, playerID, verbose = false) {
  if (verbose) console.log(boardState);
  //check which grid location the mouse press occurred
  let ht = canvas.height;
  let wd = canvas.width;

  let rowHt = Math.floor(ht / boardState.length); //number of lists = rows
  let colWd = Math.floor(wd / boardState[0].length); //length of row = cols

  //identify which row index the click is in
  let rowIndex = 0;
  for (let i = rowHt; i < ht; i += rowHt) {
    if (clickPos.y > i - rowHt && clickPos.y < i) {
      break;
    }
    rowIndex++;
  }

  //identify which col index the click is in
  let colIndex = 0;
  for (let i = colWd; i < wd; i += colWd) {
    if (clickPos.x > i - colWd && clickPos.x < i) {
      break;
    }
    colIndex++;
  }

  let move = { row: rowIndex, col: colIndex };

  if (verbose) console.log("click found: " + rowIndex + "," + colIndex);
  //check that this move is allowed and update board(open spot - check turn order elsewhere)
  let update = false;
  if (boardState[move.row][move.col] === 0) {
    boardState[move.row][move.col] = playerID;
    if (verbose) console.log(boardState);
    update = true;
  }
  //update score
  let moveScore = 0;
  if (update) {
    moveScore = scoreMove(playerID, move, boardState, verbose);
  }
  return { score: moveScore, updated: update, row: move.row, col: move.col };
}

//score move by checking surrounding board state - vertical add, horizontal subtract
//return: score of the move
//params: playerID - id for player making the move, move = {row: , col: } row/col index to be scored
//board[rows][cols] - board state array to check for scoring adjustments
function scoreMove(playerID, move, board, verbose = false) {
  let firstCheck = 0;
  let addToScore = (move.row + 1) * (move.col + 1);
  if (verbose) console.log("start score: " + addToScore);

  //check above
  for (let i = move.row - 1; i >= 0; i--) {
    //empty square or player square, not considered
    if (board[i][move.col] === 0 || board[i][move.col] === playerID) {
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
    if (board[i][move.col] === 0 || board[i][move.col] === playerID) {
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
    if (board[move.row][i] === 0 || board[move.row][i] === playerID) {
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
    if (board[move.row][i] === 0 || board[move.row][i] === playerID) {
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

//check if the board is completely filled with non zero elements
//return true if so, thus the game is complete
function checkComplete(boardState, verbose = false) {
  if (verbose) console.log(boardState);
  let emptyCount = 0;
  for (let i = 0; i < boardState.length; i++) {
    for (let j = 0; j < boardState[0].length; j++) {
      if (verbose) console.log(boardState[i][j]);
      if (boardState[i][j] == 0) {
        emptyCount++;
      }
    }
  }
  return emptyCount === 0 ? true : false;
}

//perform the score calculations given the list of player data and target
//return if it was a tie, the turn number of the winning player, and the second place score
//{tied: , winner: , closestScore: }
function checkWinner(playerArr, targetScore, verbose = false) {
  if (verbose) console.log(playerArr);
  const scoreDeltas = new Array();
  scoreDeltas.push(Math.abs(playerArr[0].score - targetScore));
  let tie = false;
  //find first place
  for (let i = 1; i < playerArr.length; i++) {
    scoreDeltas.push(Math.abs(playerArr[i].score - targetScore));
  }

  if (verbose) console.log(scoreDeltas);

  const winningScore = Math.min(...scoreDeltas)
  const winningIndex = scoreDeltas.indexOf(winningScore);
  let tieIndex = 0;
  if (verbose) console.log("with" + winningScore + ", winnner:" + winningIndex);

  //check winning index found
  if (winningIndex > -1) {
    //check if another index of the same scoreDelta exists
    tieIndex = scoreDeltas.indexOf(winningScore, winningIndex+1);
    if(tieIndex > -1){
      //tie matched
      tie = true;
      if (verbose) console.log("tie: " + tie);
    }
    else{
      tieIndex = 0;
    }
  }

  return {
    isTie: tie,
    winner: playerArr[winningIndex].turnOrder,
    tier: playerArr[tieIndex].turnOrder,
  };
}

/********************************************************************/
/*******************HTML display update functions********************/
/********************************************************************/

//update non-score related HTML for display consistency
function updateGameDisplay() {
  let playerStr = gameData.inLobby + " player(s) in lobby";
  if(gameData.players.length > 1){
    playerStr += " you are playing: ";
    let playingAs = new Array();
    for(let i = 0; i < gameData.players.length; i++){
      if(gameData.playerID === gameData.players[i].uuid){
        playingAs.push(gameData.players[i].turnOrder);
      }
    }
    if(playingAs.length > 0){
      playingAs.sort();
      for(let i = 0; i < playingAs.length; i++){
        playerStr += "player " + playingAs[i];
        if(i != playingAs.length-1){
          playerStr += " & ";
        }
      }
    }
    else{
      playerStr = gameData.inLobby + " player(s) in lobby, you are observing";
    }
  }
  $("#player-count").html(playerStr);
  $("#rows").val(gameData.size.rows);
  $("#cols").val(gameData.size.cols);
  $("#playerCount").val(gameData.players.length);
  $("#targetScore").val(gameData.targetScore);
  $("#player-num").html("Player " + gameData.currentPlayersTurn + "s turn!");
}

//update HTML to display scores
//params: players - array of player objects, playerID - current players turn
function displayScores(players) {
  let scoreStr = "";
  let str = "";
  console.log(players);
  for (let i = 0; i < players.length; i++) {
    for(let j = 0; j < players.length; j++){
      console.log("i: " + i + ", to: " + players[j].turnOrder);
      if(players[j].turnOrder === i+1){
        str += "Player " + players[j].turnOrder + " score: " + players[j].score;
        if(i != players.length - 1){
          str += " | ";
        }
        console.log(str);
        break;
      }
    }
  }
  scoreStr += str;
  $("#scoreDisplay").html(scoreStr);
}

//check if the board has any empty spaces, if not check scores against the target and determine closest player
//ties only show the first player that tied and indicate winning score
//params:
//boardState[rows][cols] - array of board state 0 or player id
//players - array of player objects with IDs and scores
//targetScore - value that scores will be assessed against
function displayWinner(winner, verbose = false) {
  if (verbose) console.log(winner);
  let winStr = "";
  if (winner.isTie) {
    winStr += "Tie for first between player " + winner.winner + " and " + winner.tier;
  } else {
    winStr += "Player " + winner.winner + " wins!";
  }
  $("#player-num").html(winStr);
}

/********************************************************************/
/***********************convenience functions************************/
/********************************************************************/

//reset the script level gameData object to a default state
//only changes game variables for clearing games - not network parameters like ID that are assigned on connection
function clearGameData() {
  gameData.size = { rows: 5, cols: 5 };
  gameData.boardState.length = 0;
  gameData.currentPlayersTurn = 1;
  gameData.players.length = 0;
  gameData.targetScore = 100;
}
