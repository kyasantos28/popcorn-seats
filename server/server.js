const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const wss = new WebSocket.Server({ port: 8080 });
// dependencies

let seatMatrix = {};
let confirmedSeats = {};
let bookings = [];
let lastTransactionId = 0;
let nextCinemaNumber = 1;
const totalCinemas = 12;
const assignedCinemaNumbers = new Map(); 
// counters trackers

const apiKey = '189d01c2';
const apiUrl = 'http://www.omdbapi.com/';
// OMDb API handling

// Database stuff (bookings.json)
const bookingsFilePath = path.join(__dirname, 'data', 'bookings.json');
const clients = new Map();
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
    console.log('Created "data" directory.');
} else {
    console.log('"data" directory already exists.');
}

if (fs.existsSync(bookingsFilePath)) {
    const data = fs.readFileSync(bookingsFilePath, 'utf8');
    bookings = JSON.parse(data);
    bookings.forEach(booking => {
        if (!confirmedSeats[booking.movieId]) {
            confirmedSeats[booking.movieId] = [];
        }
        confirmedSeats[booking.movieId].push(...booking.seats);
        assignedCinemaNumbers.set(booking.movieId, booking.cinemaNumber); 
    });
    console.log('Loaded confirmed seats from bookings.json:', confirmedSeats);

    if (bookings.length > 0) {
        const highestTransaction = bookings.reduce((max, booking) => {
            const transactionId = parseInt(booking.transactionId, 10);
            return transactionId > max ? transactionId : max;
        }, 0);
        lastTransactionId = highestTransaction;
    }
}

// Handling client requests
wss.on('connection', ws => {
    ws.on('message', message => {
        const request = JSON.parse(message);
        console.log('Received request:', request);
        
        if (request.type === 'FETCH_MOVIE_DATA') {
            const title = request.title;
            const apiUrlWithParams = `${apiUrl}?apikey=${apiKey}&s=${encodeURIComponent(title)}`;
            http.get(apiUrlWithParams, res => {
                let data = '';
                res.on('data', chunk => {
                    data += chunk;
                });
                res.on('end', () => {
                    const responseData = JSON.parse(data);
                    console.log('Fetched movie data:', responseData);
                    ws.send(JSON.stringify({ type: 'MOVIE_DATA', data: responseData }));
                });
            }).on('error', err => {
                console.error('Error fetching data:', err);
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Error fetching data.' }));
            });

        } else if (request.type === 'FETCH_MOVIE_DETAILS') {
            const movieId = request.movieId;
            clients.set(ws, movieId);
            const apiUrlWithParams = `${apiUrl}?apikey=${apiKey}&i=${movieId}&plot=full`;
            http.get(apiUrlWithParams, res => {
                let data = '';
                res.on('data', chunk => {
                    data += chunk;
                });
                res.on('end', () => {
                    const responseData = JSON.parse(data);
                    console.log('Fetched movie details:', responseData);
                    if (!seatMatrix[movieId]) {
                        seatMatrix[movieId] = Array(5).fill(null).map(() => Array(10).fill(false));
                    }
                    const movieConfirmedSeats = confirmedSeats[movieId] || [];

                    clients.set(ws, { movieId, movieTitle: responseData.Title, movieYear: responseData.Year });

                    ws.send(JSON.stringify({ type: 'MOVIE_DETAILS', data: responseData }));
                    ws.send(JSON.stringify({ type: 'SEAT_MATRIX', seatMatrix: seatMatrix[movieId], confirmedSeats: movieConfirmedSeats }));
                });
            }).on('error', err => {
                console.error('Error fetching movie details:', err);
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Error fetching movie details.' }));
            });

        } else if (request.type === 'TOGGLE_SEAT') {
            const { row, col } = request;
            const movieDetails = clients.get(ws);
            if (movieDetails) {
                const { movieId } = movieDetails;
                seatMatrix[movieId][row - 1][col - 1] = !seatMatrix[movieId][row - 1][col - 1];

                const movieConfirmedSeats = confirmedSeats[movieId] || [];
                const messageString = JSON.stringify({ type: 'SEAT_MATRIX', seatMatrix: seatMatrix[movieId], confirmedSeats: movieConfirmedSeats });

                wss.clients.forEach(client => {
                    const clientMovieDetails = clients.get(client);
                    if (client.readyState === WebSocket.OPEN && clientMovieDetails && clientMovieDetails.movieId === movieId) {
                        client.send(messageString);
                    }
                });
            }

        } else if (request.type === 'CONFIRM_BOOKING') {
            const selectedSeats = request.selectedSeats;
            const bookingDateTime = new Date().toLocaleString();
            const movieDetails = clients.get(ws);
        
            if (movieDetails) {
                const { movieId, movieTitle, movieYear } = movieDetails;
                console.log('Booking confirmed at:', bookingDateTime);
                console.log('Seats:', selectedSeats);
        
                if (!confirmedSeats[movieId]) {
                    confirmedSeats[movieId] = [];
                }
        
                selectedSeats.forEach(seat => {
                    confirmedSeats[movieId].push(seat);
                    seatMatrix[movieId][seat.row - 1][seat.col - 1] = false;
                });
        
                let cinemaNumber;
                if (assignedCinemaNumbers.has(movieId)) {
                    cinemaNumber = assignedCinemaNumbers.get(movieId);
                } else {
                    cinemaNumber = assignCinemaNumber(movieId); 
                }
        
                const bookingDetails = { 
                    movieId, 
                    movieTitle, 
                    movieYear, 
                    seats: selectedSeats, 
                    dateTime: bookingDateTime, 
                    cinemaNumber 
                };
                saveBookingDetails(bookingDetails);
        
                generateInvoice(bookingDetails).then(base64String => {
                    const messageString = JSON.stringify({ 
                        type: 'BOOKING_CONFIRMED', 
                        selectedSeats, 
                        confirmedSeats: confirmedSeats[movieId], 
                        cinemaNumber, 
                        invoice: base64String
                    });
        
                    wss.clients.forEach(client => {
                        const clientMovieDetails = clients.get(client);
                        if (client.readyState === WebSocket.OPEN && clientMovieDetails && clientMovieDetails.movieId === movieId) {
                            client.send(messageString);
                        }
                    });
                }).catch(err => {
                    console.error('Error generating invoice:', err);
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Error generating invoice.' }));
                });
            }
        }        
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});

// Getting booked movies from bookings.json as a reference for the display of booked movies

function assignCinemaNumber(movieId) {
    let assignedCinemaNumber;
    for (let i = 1; i <= totalCinemas; i++) {
        if (!Array.from(assignedCinemaNumbers.values()).includes(i)) {
            assignedCinemaNumber = i;
            assignedCinemaNumbers.set(movieId, i);
            break;
        }
    }
    if (!assignedCinemaNumber) {
        assignedCinemaNumber = nextCinemaNumber;
        nextCinemaNumber = (nextCinemaNumber % totalCinemas) + 1;
        assignedCinemaNumbers.set(movieId, assignedCinemaNumber);
    }
    return assignedCinemaNumber;
}

// Writing booking details to bookings.json
function saveBookingDetails(bookingDetails) {
    console.log('Starting to save booking details...');

    lastTransactionId++;
    const transactionId = lastTransactionId.toString().padStart(6, '0');
    bookingDetails.transactionId = transactionId;

    bookings.push(bookingDetails);

    fs.writeFile(bookingsFilePath, JSON.stringify(bookings, null, 2), err => {
        if (err) {
            console.error('Error writing updated bookings file:', err);
        } else {
            console.log('Added new booking details to bookings.json:', bookingDetails);
        }
    });
}

// Server generating invoice/s
function generateInvoice(bookingDetails) {
    return new Promise((resolve, reject) => {
        try {
            const buffers = [];
            const invoiceDir = path.join(__dirname, 'invoices');

            // Ensure the invoices directory exists
            if (!fs.existsSync(invoiceDir)) {
                fs.mkdirSync(invoiceDir);
                console.log('Created "invoices" directory.');
            } else {
                console.log('"invoices" directory already exists.');
            }

            const dateTimeForFileName = bookingDetails.dateTime.replace(/[\/:]/g, '-');
            const invoiceFilePath = path.join(invoiceDir, `${dateTimeForFileName}_${bookingDetails.transactionId}.pdf`);

            const doc = new PDFDocument({
                size: [300.46, 270.73], // converted 10cm x 9cm to points
                margin: 10 
            });

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                try {
                    const pdfData = Buffer.concat(buffers);
                    fs.writeFileSync(invoiceFilePath, pdfData);
                    const base64String = pdfData.toString('base64');
                    resolve(base64String);
                } catch (writeErr) {
                    console.error('Error writing PDF file:', writeErr.message);
                    reject(`Error writing PDF file: ${writeErr.message}`);
                }
            });

            doc.on('error', (err) => {
                console.error('Error generating PDF document:', err.message);
                reject(`Error generating PDF document: ${err.message}`);
            });

            // Register fonts at the start of the function
            doc.registerFont('Monaco', path.join(__dirname, 'fonts', 'Monaco.ttf'));
            doc.registerFont('Barcode', path.join(__dirname, 'fonts', 'barcode.ttf'));

            const feePerSeat = 200;

            bookingDetails.seats.forEach((seat, index) => {
                if (index > 0) doc.addPage();

                doc.font('Monaco')
                    .fontSize(12)
                    .text('Popcorn Seats', { align: 'center' });
                doc.moveDown(1);

                // Booking details
                doc.fontSize(10).text(`Transaction ID: ${bookingDetails.transactionId}`);
                doc.fontSize(10).text(`Cinema: ${bookingDetails.cinemaNumber}`); // Include cinema number
                doc.fontSize(10).text(`Movie: ${bookingDetails.movieTitle} (${bookingDetails.movieYear})`);
                doc.moveDown(0.5);

                doc.fontSize(10).text('Seat:', { underline: true });
                doc.fontSize(15).text(`R${seat.row}C${seat.col}`, { indent: 20 });
                doc.moveDown(0.5);

                doc.fontSize(10).text(`Date: ${bookingDetails.dateTime}`);
                doc.moveDown(0.5);
                doc.fontSize(13).text(`Fee: ${feePerSeat} PHP`);
                doc.moveDown(1);

                doc.fontSize(8).text('Present this invoice to the cashier.', { align: 'center' });

                // Barcode
                const barcodeText = `${bookingDetails.transactionId}-R${seat.row}C${seat.col}`;
                doc.fontSize(25).font('Barcode').text(barcodeText, doc.x + 10, doc.y + 10, { align: 'center' });
                doc.fontSize(10).font('Monaco').text('*' + barcodeText + '*', { align: 'center' });
                doc.moveDown(1);
                console.log("invoice generated")
            });

            doc.end();
        } catch (err) {
            console.error('Error generating invoice:', err.message);
            reject(`Error generating invoice: ${err.message}`);
        }
    });
}

module.exports = generateInvoice;

// Deleting old bookings after 24 hours of confirmation
function deleteOldBookings() {
    const currentDate = new Date();
    const thresholdDate = new Date(currentDate - 24 * 60 * 60 * 1000); // 24 hours ago

    const filteredBookings = bookings.filter(booking => {
        const bookingDateTime = new Date(booking.dateTime);
        return bookingDateTime >= thresholdDate;
    });

    if (filteredBookings.length !== bookings.length) {
        // If no bookings remain, ensure the file contains at least an empty array
        const dataToWrite = filteredBookings.length > 0 ? filteredBookings : [];

        fs.writeFile(bookingsFilePath, JSON.stringify(dataToWrite, null, 2), err => {
            if (err) {
                console.error('Error writing updated bookings file:', err);
            } else {
                console.log('Deleted old booking details from bookings.json');
                // Remove old cinema numbers from the set of assigned cinema numbers
                const oldCinemaNumbers = bookings.filter(booking => {
                    const bookingDateTime = new Date(booking.dateTime);
                    return bookingDateTime < thresholdDate;
                }).map(booking => booking.cinemaNumber);

                oldCinemaNumbers.forEach(cinemaNumber => {
                    assignedCinemaNumbers.delete(cinemaNumber);
                });
            }
        });
    }
}

// Function call to delete old bookings
deleteOldBookings();

console.log('WebSocket server is running on ws://localhost:8080');

