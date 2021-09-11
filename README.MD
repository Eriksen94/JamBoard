# Number Jam

https://number-jam.herokuapp.com

A turn based game of filling in a grid and competing to be the closest to the target score
Rules:

1. take turns in order
2. select a square to fill and be scored
3. game ends when board is full

Scoring:

1. each square is worth the value of the row X the col where it resides. top left is 1,1 bottom right is row,col. I.E playing 2,3 would be worth 6 points.
2. for each opposing players square above or below the played square, the values are added to your move
3. for each opposing players square to the left or right, the values are subtracted from your move

Design:

* made as a node.js application using socket.io for real time matching between the game boards
* implements a lobby system for hosting and joining games

Improvements:

* option to fill random blocked spots when setting up
* re-join after disconnect
