# Image to Searchable PDF Converter with Multi-Engine OCR

Full-stack web application for generating high-quality, searchable PDF documents from images using an advanced, multi-provider Optical Character Recognition (OCR) pipeline.

## 🌟 Key Features

* **Multi-Engine OCR Pipeline:** Supports plug-and-play OCR using **Azure Read**, **Google Vision**, **PaddleOCR**, and **Tesseract** for superior text accuracy and resilience.
* **Dynamic Cropping & Line OCR:** Interactive frontend component allows users to define specific regions for single-line OCR, ideal for handwritten or complex form fields.
* **Searchable PDF Generation:** Creates standard PDF files with an invisible text layer, making the original image content fully searchable and indexable.
* **Secure & Scalable:** Implements **JWT-based authentication** for a secure, user-specific file management system.
* **High-Quality Preprocessing:** Utilizes **Sharp** for robust image preparation and optimization prior to OCR processing.
* **User-Specific Management:** Dedicated backend logic for managing each user's uploaded files and generated outputs.

## 🛠️ Tech Stack

### Frontend (Client)

* React (Vite)
* Custom Cropper Component
* Fetch API

### Backend & Database (Server)

* Node.js + Express
* PostgreSQL
* JWT Authentication

### OCR & Utilities

* Azure Read API
* Google Vision OCR
* PaddleOCR
*Tesseract
* OCRmyPDF
* pdf-lib


## 📁 Project Structure

.
├── client/          # React frontend source code
├── server/          # Node.js backend source code
├── uploads/         # Directory for user uploaded images
├── out/             # Directory for generated searchable PDFs
└── keys/            # API credentials and private keys




## ⚙️ Installation

1. **Clone the repository:**

git clone git@github.com:yourusername/ocr-app.git


2. **Install Backend Dependencies:**

cd server
npm install

3. **Install Frontend Dependencies:**

cd ../client
npm install

4. **Configure Environment:** Create and configure the necessary environment variables in the server/.env file. (Requires database connection string and OCR API keys).



   

## 🚀 Running the Project

### 1. Start Backend (API)

cd server
npm run dev
* Backend running on http://localhost:5000


### 2. Start Frontend (Client)

cd client
npm run dev
* Frontend running on http://localhost:5173


## Dynamic Crop OCR API Example

Endpoint: POST /api/ocr/crop-line

This API is used to extract high-accuracy text from a defined region on a pre-uploaded image.

### Request Body:

{
  "filename": "example.jpg",
  "box": { "x": 0.1, "y": 0.75, "w": 0.8, "h": 0.12 },
  "lang": "tur+eng"
}


### Response:

{
  "text": "Response includes extracted handwritten or typed text."
}


## 🗺️ Roadmap

- Improved handwriting recognition models and training.

- Automatic form field and key-value pair detection for structured output.

- Support for multi-page PDF processing and queueing.

- User dashboard with detailed file history and usage statistics.

- Export OCR results to popular structured formats (Excel / JSON).

## ⚖️ License

This project is created for academic and personal development purposes. All rights reserved. No explicit license is granted for commercial use, modification, or redistribution without express written permission from the author.
