# Security Specification - LunchRun

## 1. Data Invariants
- A `FoodRun` must have a valid runner (owner).
- `Order` documents must belong to an existing `FoodRun`.
- A user can only join a `FoodRun` if `orderCount < maxOrders`.
- Only the runner of a `FoodRun` can change its status to 'departed' or 'arrived'.
- All IDs must be alpha-numeric.
- Domain segmentation: Users can only see and interact with data in their own domain (based on email).

## 2. The "Dirty Dozen" Payloads (Targets for PERMISSION_DENIED)

### Runner Identity Spoofing
1. Create a `FoodRun` where `runnerEmail` is someone else's email.
2. Create a `FoodRun` where `runnerId` is someone else's UID.

### Unauthorized State Changes
3. Non-runner attempts to set `status` of a run to 'departed'.
4. User attempts to set `status` of a finished run ('arrived') back to 'active'.

### Capacity Breaches
5. Join a run where `orderCount` has already reached `maxOrders`.
6. Update a run's `orderCount` without actually creating an order document in a batch. (Atomic sync check).

### Data Integrity
7. Create an order with a massive `itemDescription` (e.g. 1MB string) to cause Denial of Wallet.
8. Inject script tags or invalid characters into `destination` or `arrivalLocation`.

### Privacy / Domain Leaks
9. Read runs from a different `domainId` than the user's email domain.
10. Attempt to list all domains using wildcard queries.

### Ghost Fields
11. Add a `freeFood: true` field to a `FoodRun` update.
12. Create a User profile with `role: 'ADMIN'` when not permitted.

## 3. Test Runner Strategy
We will use `@firebase/rules-unit-testing` or similar if available, but primarily we will enforce these via strictly defined `firestore.rules`.

## 4. Relationship Map
- Primary Key: `domainId` (extracted from user email).
- Child: `runs`, `waitlist`, `users`.
- Grand-child: `runs/{runId}/orders`.
- Access Policy: `isSignedIn() && domainId == extractDomain(request.auth.token.email)`.
