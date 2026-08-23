# Software developement lifecycle instructions

## Development Stack:
- Language paradigm: Javascript
### Frontend
- React for conmponentized frontend
- React-router
- Zustand (state management)
- Axios (API client)

### Backend
- Express

# Structure
*The Structure of the application should be as follows:*
- The architecture should be essentially a client/server architecture with the provided stack.
- API contracts, database schemas should be explicitly provided in a docs folder.
- Client should include a src folder with all the modules that are used inf frotend. Example: /api(for api service), /store(for zustand store).
- Server should include a api contracts file that would define the api endpoints convention.

# Architecture
- Keep a client/server architecture for the software.
- the software should be Two-page website for now, as it would contain a initial authorization page, then a reconciliation page. 
- The design document is provided for UI design decisions.