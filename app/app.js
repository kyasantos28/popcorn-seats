const ws = new WebSocket('ws://localhost:8080');
//connecting to websocket

let lastMovieData = null;
let seatMatrix = Array(5).fill(null).map(() => Array(10).fill(false));
let confirmedSeats = [];
let bookedMoviesMap = new Map();


console.log(bookedMoviesMap)
// trackers and mapping

// get booked movies once the client has connected
ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'FETCH_BOOKED_MOVIES' }));
};



// handling communication (request and response) from the server
ws.onmessage = event => {
    const response = JSON.parse(event.data);
    console.log('Received response:', response);

    if (response.type === 'MOVIE_DATA') {
        displayMovieData(response.data);
    } else if (response.type === 'MOVIE_DETAILS') {
        displayMovieDetails(response.data);
    } else if (response.type === 'SEAT_MATRIX') {
        updateSeatMatrix(response.seatMatrix, response.confirmedSeats);
    } else if (response.type === 'BOOKING_CONFIRMED') {
        markSeatsAsConfirmed(response.selectedSeats);
        downloadInvoice(response.invoice);
    } else if (response.type === 'ERROR') {
        alert(response.message);
    }
};
// show section
function showSection(sectionId) {
    document.querySelectorAll('section').forEach(function(section) {
        section.style.display = 'none';
    });
    document.getElementById(sectionId).style.display = 'block';
}

// showSection("search_section")

function go_to_search_section() {
    showSection('search_section');
}


// getting movie data on search
function fetchMovieData() {
    const title = document.getElementById("movieInput").value;
    if (!title) {
        alert("Please enter a movie title.");
        return;
    }
    ws.send(JSON.stringify({ type: 'FETCH_MOVIE_DATA', title }));
}

// displaying movie data
function displayMovieData(data) {
    lastMovieData = data;
    console.log('Displaying movie data:', data);
    const movieResults = document.getElementById("movieResults");
    movieResults.innerHTML = "";

    if (data.Response === "True") {
        data.Search.forEach(movie => {
            const movieDiv = document.createElement("div");
            movieDiv.classList.add("movie");
            movieDiv.addEventListener("click", () => {
                fetchAndDisplayMovieDetails(movie.imdbID);
            });

            const moviePoster = document.createElement("img");
            moviePoster.src = movie.Poster !== "N/A" ? movie.Poster : "placeholder.png";
            moviePoster.alt = `Poster of ${movie.Title}`;
            moviePoster.style.display = "block";
            
            const movieTitle = document.createElement("h2");
            movieTitle.className = "movie-title";
            movieTitle.textContent = movie.Title;

            const movieYear = document.createElement("p");
            movieYear.textContent = `Year: ${movie.Year}`;

            
            movieDiv.appendChild(moviePoster);
            movieDiv.appendChild(movieTitle);
            movieDiv.appendChild(movieYear);
            

            movieResults.appendChild(movieDiv);
        });
        document.getElementById('searchBar').setAttribute("class", "movieR")
        document.getElementById('myVideo').style.display = "none"
    } else {
        alert('No results found.');
    }
}

// fetching and calling function displayMovieDetails() to display detailed description of the movie
function fetchAndDisplayMovieDetails(movieId) {
    ws.send(JSON.stringify({ type: 'FETCH_MOVIE_DETAILS', movieId }));
    const searchBar = document.getElementById("searchBar");
    searchBar.style.display = "none";
    displayedMovies.style.display = "none";
}

function displayMovieDetails(data) {
    console.log('Displaying movie details:', data);
    const movieResults = document.getElementById("movieResults");
    document.getElementById("myVideo").style.display ="none"
    document.getElementById("mDetails_section").style.display="block"

    
    movieResults.innerHTML = `
            <nav class="navbar">
                <div class="navbar-brand">
                    <img class="img-header" src="images/logo.png" alt="Logo">
                </div>
                <div class="navbar-toggler" onclick="toggleOffcanvas()">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <ul class="navbar-nav">
                    <li class="nav-item"><a class="nav-link" onclick="goBackToResults()" href="#">Movies</a></li>
                    <li class="nav-item"><a class="nav-link" href="#videoEmbed">Trailer</a></li>
                    <li class="nav-item"><a class="nav-link" href="#bookingSeat">Book Now</a></li>
                </ul>
            </nav>
            <div class="offcanvas" id="offcanvas">
                <div class="offcanvas-header">
                    <h5 class="offcanvas-title">Popcorn Seats</h5>
                    <button class="btn-close" onclick="toggleOffcanvas()">&times;</button>
                </div>
                <div class="offcanvas-body">
                    <ul class="offcanvas-nav">
                        <li class="nav-item"><a class="nav-link" onclick="goBackToResults()" href="#">Movies</a></li>
                        <li class="nav-item"><a class="nav-link" href="#videoEmbed">Trailer</a></li>
                        <li class="nav-item"><a class="nav-link" href="#bookingSeat">Book Now</a></li>
                    </ul>
                </div>
            </div>

            <div id ="details">
                <div class="movietrailer_cont"> 
                    <div id="videoEmbed" style="display:none;"></div>
                    <div class = "movieData"> 
                        <h2>${data.Title}</h2>
                        <p>Year: ${data.Year}</p>
                        <p id="plot">Plot: ${data.Plot}</p>
                        <p>Actors: ${data.Actors}</p>
                        <p>Director(s): ${data.Director}</p>
                        <p>Writer(s): ${data.Writer}</p>
                        <p>Genre: ${data.Genre}</p>
                    </div>
                </div>
            </div> 

            <div id ="bookingSeat">
                <div>
                    <img src="${data.Poster !== "N/A" ? data.Poster : 'placeholder.png'}" alt="Poster of ${data.Title}">
                </div>
                <div class="selectionSeat">
                    <h2>Select Your Seats</h2>
                    <ul class="showcase">
                        <li><div class="SEATS"></div><small>N/A</small></li>
                        <li><div class="SEATS SELECT"></div><small>Selected</small></li>
                        <li><div class="SEATS unavailable"></div><small>Occupied</small></li>    
                    </ul>
                    <div class="screen"></div>
                    <div id="seatMap"></div>
                    <button onclick="confirmBooking()">Confirm Booking</button> 
                </div>
            </div>
            
    `;
    initializeSeatMatrix();
    displayMovieTrailer(data.imdbID)
        .then(movieDetails => {
            if (movieDetails && movieDetails.title && movieDetails.trailer && movieDetails.trailer.youtube_video_id) {
                const youtubeVideoId = movieDetails.trailer.youtube_video_id;
                embedYouTubeVideo(youtubeVideoId);
            } else {
                console.log('Movie details not found or YouTube video ID not available.');
            }
        })
        .catch(error => {
            console.error('Error:', error);
        });
}

function toggleOffcanvas() {
    const offcanvas = document.getElementById('offcanvas');
    offcanvas.classList.toggle('show');
}

// displaying movie trailer from tmbd API
async function displayMovieTrailer(id) {
    const apiKey = '8b6bcb73051944315c0bad105f01cc1b';
    const baseUrl = 'https://api.themoviedb.org/3/movie/';
    const params = {
        api_key: apiKey,
        append_to_response: 'videos'
    };

    try {
        const response = await fetch(`${baseUrl}${id}?${new URLSearchParams(params)}`);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const movieData = await response.json();
        

        if (movieData.videos && movieData.videos.results.length > 0) {
            const trailer = movieData.videos.results.find(video => video.type === 'Trailer');
            if (trailer) {
                return { 
                    title: movieData.title,
                    trailer: {
                        youtube_video_id: trailer.key
                    }
                };
            }
        }
        
        // If no trailer found, return null
        return null;
    } catch (error) {
        console.error('Error fetching data:', error);
        return null;
    }
}

//embedding youtube video with reference from kinocheck database api
function embedYouTubeVideo(youtubeVideoId) {
    const embedContainer = document.getElementById("videoEmbed");
    embedContainer.style.display = "block";

    //pwede to ma-edit sa css. treat them how you treat normal html elements.
    const youtubeEmbedHtml = `
        <iframe
            width="560"
            height="315"
            src="https://www.youtube.com/embed/${youtubeVideoId}"
            frameborder="0"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
        ></iframe>
    `;
    embedContainer.innerHTML = youtubeEmbedHtml;
}

// back button to view previously loaded stuff
function goBackToResults() {
    const searchBar = document.getElementById("searchBar");
    const displayedMovies = document.getElementById("bookedMovies");
    const videoEmbed = document.getElementById("videoEmbed")
    
    searchBar.style.display = "flex";
    videoEmbed.style.display = "none";
    displayedMovies.style.display = "flex";
    displayMovieData(lastMovieData);
}

// initializing seat matrix and toggling/confirmed calls
function initializeSeatMatrix() {
    const seatMap = document.getElementById('seatMap');
    seatMap.innerHTML = "";

    for (let row = 0; row < seatMatrix.length; row++) {
        for (let col = 0; col < seatMatrix[row].length; col++) {
            const seat = document.createElement('div');
            seat.classList.add('seat');
            seat.dataset.row = row + 1;
            seat.dataset.col = col + 1;
            if (seatMatrix[row][col] === true) {
                seat.classList.add('selected');
            }
            seat.addEventListener('click', () => toggleSeat(row + 1, col + 1));
            seatMap.appendChild(seat);
        }
        seatMap.appendChild(document.createElement('br'));
    }
    markSeatsAsConfirmed(confirmedSeats);
}

// updating seatmatrix bookings real-time
function updateSeatMatrix(matrix, confirmedSeats) {
    seatMatrix = matrix;
    const seatMap = document.getElementById('seatMap');
    const seats = seatMap.querySelectorAll('.seat');

    seats.forEach(seat => {
        const row = parseInt(seat.dataset.row);
        const col = parseInt(seat.dataset.col);
        seat.classList.remove('selected', 'confirmed');

        if (seatMatrix[row - 1][col - 1]) {
            seat.classList.add('selected');
        }

        confirmedSeats.forEach(confirmedSeat => {
            if (confirmedSeat.row === row && confirmedSeat.col === col) {
                seat.classList.add('confirmed');
            }
        });
    });
}

function toggleSeat(row, col) {
    ws.send(JSON.stringify({ type: 'TOGGLE_SEAT', row, col }));
}

// requesting server to broadcast seat toggle to the clients that are viewing the same movie
function markSeatsAsConfirmed(seats) {
    seats.forEach(seat => {
        const seatElement = document.querySelector(`.seat[data-row="${seat.row}"][data-col="${seat.col}"]`);
        if (seatElement) {
            seatElement.classList.remove('selected');
            seatElement.classList.add('confirmed');
        }
    });
}

// function to send booking details to server when confirm booking is clicked
function confirmBooking() {
    const selectedSeats = document.querySelectorAll('.seat.selected');
    if (selectedSeats.length === 0) {
        alert('Please select at least one seat.');
        return;
    }

    const selectedSeatInfo = Array.from(selectedSeats).map(seat => ({
        row: parseInt(seat.dataset.row),
        col: parseInt(seat.dataset.col)
    }));

    const bookingData = {
        type: 'CONFIRM_BOOKING',
        selectedSeats: selectedSeatInfo
    };

    ws.send(JSON.stringify(bookingData));
}


//download invoice pdf file from the server
function downloadInvoice(base64String) {
    const link = document.createElement('a');
    link.href = `data:application/pdf;base64,${base64String}`;
    link.download = '[Invoice] Movie House.pdf';
    link.click();
}

