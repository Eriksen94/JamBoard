let debug = true;

function changeTitle(str) {
  $("#page-title").text("Hello: " + str);
}

var socket = io();

//client side AJAX is needed for post method without reloading/redirecting
$(() => {
  $("#setup-btn").click(function () {
    var data = { rows: $("#rows").val(), cols: $("#cols").val() };
    $.post("http://localhost:3000/test", data);
  });
});

socket.on("socketCall", drawBoard);

var canvas = document.getElementById("viewport");
var context = canvas.getContext("2d");
var gameData = {
  size: { rows: 5, cols: 5 },
  boardState: new Array(),
  lastPlayerID: 1,
  players: new Array(),
  targetScore: 100,
};

function Player(uuid, id, colour, score) {
  this.uuid = uuid;
  this.id = id;
  this.colour = colour;
  this.score = score;
}

//check where mouse click is on canvas (scaled for css size changes)
canvas.addEventListener("mousedown", function (e) {
  let t = getMousePos(canvas, e);
  let s = boardClick(t, gameData.boardState, gameData.lastPlayerID);
  fillBoard(gameData.boardState, gameData.players);
  gameData.players[gameData.lastPlayerID - 1].score += s;
  if (debug)
    console.log(
      "player: " +
        gameData.lastPlayerID +
        ", score: " +
        gameData.players[gameData.lastPlayerID - 1].score
    );
  gameData.lastPlayerID++;
  if (gameData.lastPlayerID > 2) gameData.lastPlayerID = 1;
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

//draw grid lines on the canvas
//return array of 0s for the size passed in
//params: size {rows: ..., cols: ...}
//canvas context is script scoped
function drawBoard(size, verbose = false) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  let ht = canvas.height;
  let wd = canvas.width;

  let rowHt = Math.floor(ht / size.rows);
  let colWd = Math.floor(wd / size.cols);

  for (let x = rowHt; x < ht - rowHt + 1; x += rowHt) {
    context.moveTo(0, x);
    context.lineTo(wd, x);
    if (verbose) console.log("line: 0," + x + " to " + wd + "," + x);
  }

  for (let x = colWd; x < wd - colWd + 1; x += colWd) {
    context.moveTo(x, 0);
    context.lineTo(x, ht);
    if (verbose) console.log("line: " + x + ",0 to " + x + "," + ht);
  }

  context.strokeStyle = "#FFFFFF";
  context.lineWidth = 2;
  context.stroke();

  let tempBoard = new Array();
  for (let i = 0; i < size.rows; i++) {
    let tempRow = new Array(size.cols).fill(0);
    tempBoard.push(tempRow);
  }
  return tempBoard;
}

//colour in boxes on the canvas based on the array indicating board state
//params: boardState[rows][cols] - 0 = blank, otherwise filled with player id
//playersArr[] {uuid: , id: , colour} - match id and colour for fill colour
function fillBoard(boardState, playersArr, verbose = false) {
  if (verbose) console.log(boardState);
  //board state - 2d array of rows and cols indicating filled or blank
  let ht = canvas.height;
  let wd = canvas.width;

  let rowHt = Math.floor(ht / boardState.length); //number of lists = rows
  let colWd = Math.floor(wd / boardState[0].length); //length of row = cols

  for (let x = 0; x < boardState.length; x++) {
    for (let j = 0; j < boardState[0].length; j++) {
      if (boardState[x][j] > 0) {
        for (let k = 0; k < playersArr.length; k++) {
          if (boardState[x][j] === playersArr[k].id) {
            context.fillStyle = playersArr[k].colour;
            break;
          }
        }
        //identify coordinates, then fill
        let xStart = colWd * j;
        let yStart = rowHt * x;
        let adjust = [1, 1, -2, -2]; //2px grid lines
        if (x === 0) {
          //first row
          adjust[1] = 0;
          adjust[3] = -1;
        }
        if (j === 0) {
          //first col
          adjust[0] = 0;
          adjust[2] = -1;
        }
        context.fillRect(
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
    }
  }
}

//check which grid space a click on the canvas occurred in
//if the space is available update the board state for the player
//return: score of the move and update script scope board state - draw updated board elsewhere
//Params: clickPos = {x: , y: } scaled position of the cursor when pressed down on canvas element, calculated in event listener
//boardState[rows][cols] - array of board state 0 or player id
//playerID - id for the player that made the click - enforce turn requirements elsewhere
function boardClick(clickPos, boardState, playerID, verbose = false) {
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
    moveScore = scoreMove(playerID, move, boardState);
  }
  return moveScore;
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

function testFill() {
  gameData.size = { rows: 6, cols: 6 };
  gameData.boardState = drawBoard(gameData.size, debug);
  if (debug) console.log(gameData.boardState);
  // gameData.boardState = [
  //   [1, 2, 0, 2, 0, 0],
  //   [0, 0, 0, 1, 0, 0],
  //   [0, 0, 0, 2, 0, 0],
  //   [0, 2, 2, 0, 2, 0],
  //   [0, 1, 0, 2, 0, 0],
  //   [2, 0, 0, 2, 0, 1],
  // ];
  let p1 = new Player("p1-uuid", 1, "#229284", 0);
  let p2 = new Player("p2-uuid", 2, "#499222", 0);
  gameData.players.push(p1);
  gameData.players.push(p2);
  //fillBoard(gameData.boardState, gameData.players);

  // let move = {row: 3, col: 5};
  // let player = 1;
  // scoreMove(player, move, board);
}

testFill();
