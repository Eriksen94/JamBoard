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

socket.on("socketCall", drawGrid);

var canvas = document.getElementById("viewport");
var context = canvas.getContext("2d");
function drawGrid(size) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  let ht = canvas.height;
  let wd = canvas.width;

  let rowHt = Math.floor(ht / size.rows);
  let colWd = Math.floor(wd / size.cols);

  for (let x = rowHt; x < (ht-rowHt+1); x += rowHt) {
    context.moveTo(0, x);
    context.lineTo(wd, x);
  }

  for (let x = colWd; x < (wd-colWd + 1); x += colWd) {
    context.moveTo(x, 0);
    context.lineTo(x, ht);
  }

  context.strokeStyle = "#FFFFFF";
  context.stroke();
}

function fillBoard(boardState){
  //board state - 2d array of rows and cols indicating filled or blank
  let ht = canvas.height;
  let wd = canvas.width;

  let rowHt = Math.floor(ht / boardState.length); //number of lists = rows
  let colWd = Math.floor(wd / boardState[0].length); //length of row = cols

  context.fillStyle = "#228B22";
  for(let x = 0; x < boardState.length; x++){
    for(let j = 0; j < boardState[0].length; j++){
      if(boardState[x][j] > 0){
        //identify coordinates, then fill
        let xStart = colWd * j;
        let yStart = rowHt * x;
        context.fillRect(xStart, yStart, colWd, rowHt);
      }
    }
  }
}

function testFill(){
  drawGrid({rows: 5, cols: 6});
  let state = [
    [1,0,0,0,0,0],
    [0,0,0,1,0,0],
    [0,0,0,0,0,0],
    [0,0,0,0,0,0],
    [0,1,0,0,0,0],
    [0,0,0,0,0,1]
  ];
  fillBoard(state);
}

testFill();