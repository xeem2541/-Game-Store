-- โมดูล Cars (ส่วนหนึ่งของ RoadTripBuilder) : ModuleScript ชื่อ Cars
return function(S)
local RunService, CAR_MAX_SPEED, BOOST_MULT, WHEEL_RADIUS, DRIVE_SIGN, STEER_SIGN, rng, carsF, spawn, checkpoints, playerState, cars = S.RunService, S.CAR_MAX_SPEED, S.BOOST_MULT, S.WHEEL_RADIUS, S.DRIVE_SIGN, S.STEER_SIGN, S.rng, S.carsF, S.spawn, S.checkpoints, S.playerState, S.cars

local carColors = {
	Color3.fromRGB(235, 50, 60), Color3.fromRGB(50, 120, 240), Color3.fromRGB(250, 190, 40),
	Color3.fromRGB(60, 200, 110), Color3.fromRGB(240, 120, 200), Color3.fromRGB(240, 240, 245),
}

local function weld(a, b)
	local w = Instance.new("WeldConstraint")
	w.Part0 = a
	w.Part1 = b
	w.Parent = a
end

local function buildCar(cf, player)
	local color = carColors[rng:NextInteger(1, #carColors)]
	local model = Instance.new("Model")
	model.Name = player.Name .. "_Car"
	model:SetAttribute("OwnerUserId", player.UserId)

	local seat = Instance.new("VehicleSeat")
	seat.Name = "Seat"
	seat.Size = Vector3.new(6, 1, 9)
	seat.CFrame = cf
	seat.Color = color
	seat.Material = Enum.Material.SmoothPlastic
	seat.HeadsUpDisplay = false
	seat.MaxSpeed = 0
	seat.Torque = 0
	seat.TurnSpeed = 0
	seat.CustomPhysicalProperties = PhysicalProperties.new(0.8, 0.1, 0, 1, 1)
	seat.Parent = model
	model.PrimaryPart = seat

	local function piece(size, offset, pcolor, material, collide)
		local p = Instance.new("Part")
		p.Size = size
		p.CFrame = cf * offset
		p.Color = pcolor
		p.Material = material or Enum.Material.SmoothPlastic
		p.CanCollide = collide or false
		p.Massless = not collide
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		p.Parent = model
		weld(seat, p)
		return p
	end

	-- ตัวถัง
	piece(Vector3.new(6.4, 1.6, 3.4), CFrame.new(0, 0.9, -3.2), color)
	piece(Vector3.new(6.4, 1.4, 2.6), CFrame.new(0, 0.8, 3.4), color)
	piece(Vector3.new(6.6, 0.6, 0.8), CFrame.new(0, 0.2, -4.9), Color3.fromRGB(30, 30, 35))
	piece(Vector3.new(6.6, 0.6, 0.8), CFrame.new(0, 0.2, 4.9), Color3.fromRGB(30, 30, 35))
	local spoiler = piece(Vector3.new(6.4, 0.4, 1.4), CFrame.new(0, 2.4, 4.4), Color3.fromRGB(30, 30, 35))
	for _, s in ipairs({ -1, 1 }) do
		piece(Vector3.new(0.4, 1.4, 0.8), CFrame.new(s * 2.8, 1.7, 4.4), Color3.fromRGB(30, 30, 35))
		piece(Vector3.new(1.2, 0.5, 0.3), CFrame.new(s * 2.2, 1.0, -4.95), Color3.fromRGB(255, 255, 220), Enum.Material.Neon)
		piece(Vector3.new(1.2, 0.5, 0.3), CFrame.new(s * 2.2, 1.0, 4.75), Color3.fromRGB(255, 40, 40), Enum.Material.Neon)
	end
	spoiler.Name = "Spoiler"
	local glass = piece(Vector3.new(5.6, 0.3, 2.6), CFrame.new(0, 2.0, -1.9) * CFrame.Angles(math.rad(35), 0, 0),
		Color3.fromRGB(150, 210, 255), Enum.Material.Glass)
	glass.Transparency = 0.5

	-- ถ่วงน้ำหนักล่าง ให้รถไม่พลิกง่าย
	local ballast = piece(Vector3.new(4, 0.6, 6), CFrame.new(0, -1.3, 0), Color3.fromRGB(40, 40, 40))
	ballast.Transparency = 1
	ballast.Massless = false
	ballast.CustomPhysicalProperties = PhysicalProperties.new(4, 0.1, 0, 1, 1)

	-- ล้อ
	local motors, steers = {}, {}
	local wheelOffsets = {
		{ -3.6, -1, -3.2, true }, { 3.6, -1, -3.2, true },
		{ -3.6, -1, 3.2, false }, { 3.6, -1, 3.2, false },
	}
	for _, w in ipairs(wheelOffsets) do
		local ox, oy, oz, front = w[1], w[2], w[3], w[4]
		local wheel = Instance.new("Part")
		wheel.Name = "Wheel"
		wheel.Shape = Enum.PartType.Cylinder
		wheel.Size = Vector3.new(1.6, WHEEL_RADIUS * 2, WHEEL_RADIUS * 2)
		wheel.CFrame = cf * CFrame.new(ox, oy, oz)
		wheel.Color = Color3.fromRGB(25, 25, 28)
		wheel.Material = Enum.Material.SmoothPlastic
		wheel.TopSurface = Enum.SurfaceType.Smooth
		wheel.BottomSurface = Enum.SurfaceType.Smooth
		wheel.CustomPhysicalProperties = PhysicalProperties.new(1, 2, 0, 100, 1)
		wheel.Parent = model
		local rim = Instance.new("Part")
		rim.Shape = Enum.PartType.Cylinder
		rim.Size = Vector3.new(1.7, WHEEL_RADIUS * 1.1, WHEEL_RADIUS * 1.1)
		rim.CFrame = wheel.CFrame
		rim.Color = Color3.fromRGB(190, 190, 200)
		rim.Material = Enum.Material.Metal
		rim.CanCollide = false
		rim.Massless = true
		rim.Parent = model
		weld(wheel, rim)

		local wheelAtt = Instance.new("Attachment")
		wheelAtt.Parent = wheel

		local parentPart, parentAttCF
		if front then
			local knuckle = Instance.new("Part")
			knuckle.Name = "Knuckle"
			knuckle.Size = Vector3.new(0.6, 0.6, 0.6)
			knuckle.CFrame = cf * CFrame.new(ox, oy, oz)
			knuckle.Transparency = 1
			knuckle.CanCollide = false
			knuckle.Parent = model

			local sa0 = Instance.new("Attachment")
			sa0.CFrame = CFrame.new(ox, oy, oz) * CFrame.Angles(0, 0, math.pi / 2)
			sa0.Parent = seat
			local sa1 = Instance.new("Attachment")
			sa1.CFrame = CFrame.Angles(0, 0, math.pi / 2)
			sa1.Parent = knuckle
			local servo = Instance.new("HingeConstraint")
			servo.Attachment0 = sa0
			servo.Attachment1 = sa1
			servo.ActuatorType = Enum.ActuatorType.Servo
			servo.ServoMaxTorque = 1e6
			servo.AngularSpeed = 8
			servo.TargetAngle = 0
			servo.LimitsEnabled = true
			servo.LowerAngle = -40
			servo.UpperAngle = 40
			servo.Parent = seat
			table.insert(steers, servo)

			parentPart = knuckle
			parentAttCF = CFrame.new()
		else
			parentPart = seat
			parentAttCF = CFrame.new(ox, oy, oz)
		end

		local pAtt = Instance.new("Attachment")
		pAtt.CFrame = parentAttCF
		pAtt.Parent = parentPart
		local motor = Instance.new("HingeConstraint")
		motor.Attachment0 = pAtt
		motor.Attachment1 = wheelAtt
		motor.ActuatorType = Enum.ActuatorType.Motor
		motor.MotorMaxTorque = 6000
		motor.MotorMaxAcceleration = 120
		motor.AngularVelocity = 0
		motor.Parent = wheel
		table.insert(motors, motor)
	end

	return { model = model, seat = seat, motors = motors, steers = steers, flipTime = 0 }
end

local function destroyCar(player)
	local car = cars[player]
	if car then
		cars[player] = nil
		if car.model then
			car.model:Destroy()
		end
	end
end

local function spawnCar(player)
	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	local st = playerState[player]
	if not hum or hum.Health <= 0 or not st then
		return
	end
	destroyCar(player)
	local cf = checkpoints[st.progress].cf
	local car = buildCar(cf, player)
	car.model.Parent = carsF
	cars[player] = car
	char:PivotTo(cf * CFrame.new(0, 4, 0))
	car.seat:Sit(hum)
	pcall(function()
		car.seat:SetNetworkOwner(player)
	end)
end

local function resetCar(player, car)
	local st = playerState[player]
	if not st then
		return
	end
	local cf = checkpoints[st.progress].cf
	car.model:PivotTo(cf)
	for _, p in ipairs(car.model:GetDescendants()) do
		if p:IsA("BasePart") then
			p.AssemblyLinearVelocity = Vector3.zero
			p.AssemblyAngularVelocity = Vector3.zero
		end
	end
	car.flipTime = 0
end

-- ควบคุมรถ (รันบน server อ่านค่าจาก VehicleSeat ของคนขับ)
RunService.Heartbeat:Connect(function(dt)
	local now = os.clock()
	for player, car in pairs(cars) do
		local seat = car.seat
		if seat and seat.Parent then
			local throttle = seat.ThrottleFloat
			local steer = seat.SteerFloat
			local boosting = now < (car.model:GetAttribute("BoostUntil") or 0)
			if boosting and throttle >= 0 then
				throttle = 1
			end
			car.model:SetAttribute("Boosting", boosting)

			local maxSpeed = CAR_MAX_SPEED * (boosting and BOOST_MULT or 1)
			if throttle < 0 then
				maxSpeed = CAR_MAX_SPEED * 0.4
			end
			local omega = -throttle * maxSpeed / WHEEL_RADIUS * DRIVE_SIGN
			local torque = throttle ~= 0 and 80000 or 6000
			for _, m in ipairs(car.motors) do
				m.AngularVelocity = omega
				m.MotorMaxTorque = torque
			end

			local speed = seat.AssemblyLinearVelocity.Magnitude
			local maxAngle = 32 * (1 - 0.6 * math.clamp(speed / 150, 0, 1))
			for _, s in ipairs(car.steers) do
				s.TargetAngle = -steer * maxAngle * STEER_SIGN
			end
		end
	end
end)

-- รถตกแมพ / พลิกคว่ำนาน ๆ -> กลับไปเช็คพอยต์
task.spawn(function()
	while true do
		task.wait(0.5)
		for player, car in pairs(cars) do
			local seat = car.seat
			if seat and seat.Parent then
				if seat.Position.Y < -30 then
					resetCar(player, car)
				elseif seat.CFrame.UpVector.Y < 0.25 then
					car.flipTime = car.flipTime + 0.5
					if car.flipTime >= 4 then
						resetCar(player, car)
					end
				else
					car.flipTime = 0
				end
			end
		end
	end
end)

S.weld = weld
S.buildCar = buildCar
S.destroyCar = destroyCar
S.spawnCar = spawnCar
S.resetCar = resetCar
S.carColors = carColors
S.spawnCar = spawnCar
end
