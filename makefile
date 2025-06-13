.PHONY: all build run clean

all: build

build:
	@echo "Building the application..."
	@go build -o delivery-tracker ./main.go

run: build
	@echo "Running the application..."
	@./delivery-tracker

clean:
	@echo "Cleaning up..."
	@rm -f delivery-tracker