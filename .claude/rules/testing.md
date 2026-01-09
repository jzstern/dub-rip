# Testing Rules

## Structure
- Follow BDD conventions with `#given`, `#when`, `#then` comments
- One logical assertion per test
- Use descriptive names explaining each scenario

## Mocking
- Mock external systems (APIs, databases)
- Never mock the code being tested
- Reset mocks between test cases

## Coverage
- Test the successful flow
- Test error conditions
- Test edge scenarios (empty values, null, boundaries)
- Async operations: validate loading, success, and failure states

## Example
```typescript
describe("UserService.getUser()", () => {
  // #given
  const mockUser = { id: "1", name: "Test" };

  beforeEach(() => {
    mockApi.reset();
  });

  it("returns user when found", async () => {
    // #given
    mockApi.getUser.mockResolvedValue(mockUser);

    // #when
    const result = await userService.getUser("1");

    // #then
    expect(result).toEqual(mockUser);
  });
});
```
